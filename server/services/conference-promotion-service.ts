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
import { randomUUID } from "crypto";
import { eq, and, inArray, ne } from "drizzle-orm";
import { db } from "../db";
import {
  conferences,
  conferenceSessions,
  conferenceImages,
  generatedPosts,
  socialAccounts,
  scheduledJobRuns,
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

const objectStorageService = new ObjectStorageService();

const IMAGE_PREFIX = "conference-images";

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
 * and return the servable `/objects/...` path plus its size.
 */
export async function saveConferenceImageBuffer(
  buffer: Buffer,
  contentType: string,
  ext: string,
): Promise<{ fileUrl: string; fileSize: number }> {
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!privateDir) {
    throw new Error("PRIVATE_OBJECT_DIR not set — cannot store conference image");
  }
  const objectId = `${randomUUID()}.${ext}`;
  const fullPath = `${privateDir.replace(/\/$/, "")}/${IMAGE_PREFIX}/${objectId}`;
  const { bucketName, objectName } = splitObjectPath(fullPath);
  await objectStorageClient
    .bucket(bucketName)
    .file(objectName)
    .save(buffer, { metadata: { contentType } });
  return { fileUrl: `/objects/${IMAGE_PREFIX}/${objectId}`, fileSize: buffer.length };
}

/** Read the bytes of a brand template, whether stored in object storage or at an external URL. */
async function loadImageBytes(fileUrl: string): Promise<Buffer> {
  if (fileUrl.startsWith("/objects/")) {
    const file = await objectStorageService.getObjectEntityFile(fileUrl);
    const [buf] = await file.download();
    return buf;
  }
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`Failed to fetch template image (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
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
}): Promise<Buffer> {
  const W = 1200;
  const H = 675;

  const titleLines = wrapText(opts.title, 34, 3);
  const titleSvg = titleLines
    .map(
      (l, i) =>
        `<text x="64" y="${300 + i * 64}" font-family="Arial, Helvetica, sans-serif" font-size="56" font-weight="700" fill="#ffffff">${escapeXml(l)}</text>`,
    )
    .join("");
  const speakerSvg = opts.speaker
    ? `<text x="64" y="${300 + titleLines.length * 64 + 36}" font-family="Arial, Helvetica, sans-serif" font-size="34" fill="#e2e8f0">${escapeXml(opts.speaker)}</text>`
    : "";
  const detailSvg = opts.detail
    ? `<text x="64" y="620" font-family="Arial, Helvetica, sans-serif" font-size="28" fill="#cbd5e1">${escapeXml(opts.detail)}</text>`
    : "";

  const overlay = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
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

  return base
    .composite([{ input: overlay, top: 0, left: 0 }])
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
 * Render the bytes for a conference image record according to its source, store
 * them, and update the row with fileUrl/fileSize. No-op for uploaded images
 * (the caller already supplied a fileUrl). Returns the resolved fileUrl.
 */
export async function renderConferenceImage(
  image: ConferenceImage,
  conf: Conference,
  session?: ConferenceSession | null,
): Promise<string | null> {
  if (image.source === "uploaded") {
    return image.fileUrl ?? null;
  }

  let saved: { fileUrl: string; fileSize: number };

  if (image.source === "ai_generated") {
    const prompt = (image.imagePrompt && image.imagePrompt.trim()) || defaultImagePrompt(conf, session);
    const buffer = await generateImageBuffer(prompt, "1024x1024");
    saved = await saveConferenceImageBuffer(buffer, "image/png", "png");
  } else {
    // template_composite
    let templateBytes: Buffer | null = null;
    if (image.templateAssetId) {
      const { brandAssets } = await import("@shared/schema");
      const [tpl] = await db.select().from(brandAssets).where(eq(brandAssets.id, image.templateAssetId));
      if (tpl?.fileUrl) {
        try {
          templateBytes = await loadImageBytes(tpl.fileUrl);
        } catch (err: any) {
          console.error("[Conference] Failed to load template image:", err?.message);
        }
      }
    }
    const detail = [
      session?.room,
      formatUtcDateTime(session?.sessionStart),
    ]
      .filter(Boolean)
      .join(" · ");
    const buffer = await compositeSessionGraphic({
      templateBytes,
      title: session?.title || conf.name,
      speaker: sessionSpeakerText(session),
      detail: detail || conf.eventHashtag || null,
    });
    saved = await saveConferenceImageBuffer(buffer, "image/png", "png");
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
 * posts per eligible day (skipping weekends unless included), spread across
 * business hours. Extends past promoEnd only if the window is too small.
 */
export function buildScheduleSlots(opts: {
  promoStart: Date;
  promoEnd?: Date | null;
  postsPerDay: number;
  includeSaturday: boolean;
  includeSunday: boolean;
  count: number;
}): Date[] {
  const slots: Date[] = [];
  const hours = [9, 11, 13, 15, 17];
  // Never place more than one post per distinct hour slot in a day — overflow
  // rolls to the next *eligible* day instead of spilling into an ineligible
  // (e.g. weekend) calendar day.
  const perDay = Math.min(Math.max(1, opts.postsPerDay), hours.length);
  const cursor = new Date(opts.promoStart);
  cursor.setHours(0, 0, 0, 0);
  let guard = 0;
  while (slots.length < opts.count && guard < 3650) {
    guard++;
    const day = cursor.getDay(); // 0 Sun … 6 Sat
    const eligible = (day !== 0 || opts.includeSunday) && (day !== 6 || opts.includeSaturday);
    if (eligible) {
      for (let i = 0; i < perDay && slots.length < opts.count; i++) {
        const slot = new Date(cursor);
        slot.setHours(hours[i], 0, 0, 0);
        slots.push(slot);
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return slots;
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
      session.sessionType ? `  Session type: ${session.sessionType}` : "",
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

  const variants = parseVariants(result.text, variantCount);
  return variants.length > 0 ? variants.slice(0, variantCount) : [result.text.trim()];
}

// ─── orchestration ────────────────────────────────────────────────────────────

export interface GenerateConferencePostsOptions {
  socialAccountIds: string[];
  ownerUserId: string;
  generateImages?: boolean; // render AI/composite graphics during generation (default true)
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

  const [conf] = await db
    .select()
    .from(conferences)
    .where(and(eq(conferences.id, conferenceId), eq(conferences.tenantDomain, tenantDomain)));
  if (!conf) throw new Error("Conference not found");

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
  const anchorCount = Math.min(Math.max(conf.anchorPostCount ?? 2, 1), 2);
  const generateImages = options.generateImages !== false;

  // Clear prior conference posts (everything except already-published ones) so
  // regeneration doesn't leave behind stale variant groups. Tenant-scoped.
  await db
    .delete(generatedPosts)
    .where(
      and(
        eq(generatedPosts.conferenceId, conferenceId),
        eq(generatedPosts.tenantDomain, tenantDomain),
        ne(generatedPosts.status, "published"),
      ),
    );

  // Resolve / render images. One anchor image (shared by anchor posts) + one per session.
  reportProgress?.({ phase: "Preparing graphics", percent: 15 });

  const existingImages = await db
    .select()
    .from(conferenceImages)
    .where(and(eq(conferenceImages.conferenceId, conferenceId), eq(conferenceImages.status, "active")));

  const sessionImageBySession = new Map<string, ConferenceImage>();
  let anchorImage: ConferenceImage | undefined;
  for (const img of existingImages) {
    if (img.role === "anchor" && !anchorImage) anchorImage = img;
    if (img.sessionId) sessionImageBySession.set(img.sessionId, img);
  }

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
    const toRender: Array<{ img: ConferenceImage; session?: ConferenceSession | null }> = [];
    if (anchorImage && !anchorImage.fileUrl) toRender.push({ img: anchorImage });
    for (const session of sessions) {
      const img = sessionImageBySession.get(session.id);
      if (img && !img.fileUrl) toRender.push({ img, session });
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

  // Build schedule slots: one slot per post target (anchor i, then each session).
  const targetCount = anchorCount + sessions.length;
  const slots = buildScheduleSlots({
    promoStart: conf.promoStartDate ?? conf.startDate ?? new Date(),
    promoEnd: conf.promoEndDate ?? conf.endDate,
    postsPerDay: conf.postsPerDay ?? 2,
    includeSaturday: conf.includeSaturday,
    includeSunday: conf.includeSunday,
    count: targetCount,
  });

  const baseHashtags = resolveHashtags(conf);
  let created = 0;

  // Anchor posts
  for (let a = 0; a < anchorCount; a++) {
    const scheduledDate = slots[a] ?? null;
    for (const account of accounts) {
      const variantGroup = randomUUID();
      let variants: string[] = [];
      try {
        variants = await generateCopyVariants({
          platform: account.platform,
          socialAccountId: account.id,
          tenantDomain,
          variantCount,
          conf,
          session: null,
        });
      } catch (err: any) {
        console.error("[Conference] Anchor copy generation failed:", err?.message);
        continue;
      }
      for (const content of variants) {
        await db.insert(generatedPosts).values({
          id: randomUUID(),
          tenantDomain,
          conferenceId,
          postRole: "anchor",
          conferenceImageId: anchorImage?.id ?? null,
          overrideImageUrl: anchorImage?.fileUrl ?? null,
          socialAccountId: account.id,
          platform: account.platform,
          content,
          hashtags: baseHashtags,
          variantGroup,
          scheduledDate,
          sourceUrl: conf.website ?? null,
          status: "draft",
          generationJobId: jobId,
        });
      }
    }
    created++;
    reportProgress?.({ phase: "Writing anchor posts", percent: 40 + Math.round((created / targetCount) * 10) });
  }

  // Session posts (1:1 with their matched graphic)
  for (let s = 0; s < sessions.length; s++) {
    const session = sessions[s];
    const img = sessionImageBySession.get(session.id);
    const scheduledDate = slots[anchorCount + s] ?? null;
    for (const account of accounts) {
      const variantGroup = randomUUID();
      let variants: string[] = [];
      try {
        variants = await generateCopyVariants({
          platform: account.platform,
          socialAccountId: account.id,
          tenantDomain,
          variantCount,
          conf,
          session,
        });
      } catch (err: any) {
        console.error("[Conference] Session copy generation failed:", err?.message);
        continue;
      }
      for (const content of variants) {
        await db.insert(generatedPosts).values({
          id: randomUUID(),
          tenantDomain,
          conferenceId,
          conferenceSessionId: session.id,
          postRole: "session",
          conferenceImageId: img?.id ?? null,
          overrideImageUrl: img?.fileUrl ?? null,
          socialAccountId: account.id,
          platform: account.platform,
          content,
          hashtags: baseHashtags,
          variantGroup,
          scheduledDate,
          sourceUrl: session.url ?? conf.website ?? null,
          status: "draft",
          generationJobId: jobId,
        });
      }
    }
    created++;
    reportProgress?.({
      phase: "Writing session posts",
      percent: 50 + Math.round((created / targetCount) * 48),
      currentItem: s + 1,
      totalItems: sessions.length,
      currentItemName: session.title,
    });
  }

  reportProgress?.({ phase: "Done", percent: 100 });
}
