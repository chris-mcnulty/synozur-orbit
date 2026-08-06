/**
 * Client for the Synozur Insights website ("www") MCP server, configured per
 * tenant (see `website_connections`). The server speaks MCP over Streamable
 * HTTP and is stateless — one POST per call, no initialize handshake — so each
 * tool call is a single JSON-RPC 2.0 `tools/call` request authenticated with
 * the tenant's `Bearer syn_<key>`.
 *
 * v1 surfaces only what the "direct-post blog drafts" flow needs (taxonomy
 * reads + create_draft_post), plus a connection test; the rest of the catalogue
 * can be added the same way.
 */
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { websiteConnections, type WebsiteConnection } from "@shared/schema";
import { decryptSecret } from "../utils/encryption";

export class WebsiteNotConnectedError extends Error {
  constructor() {
    super("This tenant has not connected the Synozur website. Configure it in Settings → Integrations.");
    this.name = "WebsiteNotConnectedError";
  }
}

export async function getWebsiteConnection(tenantDomain: string): Promise<WebsiteConnection | null> {
  const [row] = await db.select().from(websiteConnections).where(eq(websiteConnections.tenantDomain, tenantDomain));
  return row ?? null;
}

/** Extract the tool payload from an MCP tools/call result, tolerating either
 *  structuredContent or a JSON string inside the first text content block. */
function unwrapToolResult(result: any): any {
  if (result == null) return null;
  if (result.structuredContent !== undefined) return result.structuredContent;
  const block = Array.isArray(result.content) ? result.content.find((c: any) => c?.type === "text") : null;
  if (block?.text) {
    try { return JSON.parse(block.text); } catch { return block.text; }
  }
  return result;
}

/**
 * Read an SSE (text/event-stream) response incrementally.
 * Returns as soon as a `data:` line contains a JSON-RPC message with a
 * `result` or `error` field — we do NOT wait for the server to close the
 * connection, which is what `res.text()` would do and what caused prod hangs.
 *
 * A hard deadline of `timeoutMs` (default 25 s) cancels the reader so the
 * caller never hangs indefinitely when the website MCP sends an unrecognised
 * SSE frame shape (e.g. a tool that emits progress events before the final
 * result, or a server that keeps the stream open without sending `result`).
 * The `AbortSignal.timeout` on the outer fetch() call does not reliably abort
 * body reads in all Node.js / undici versions, hence the explicit timer here.
 */
async function parseSSEStream(res: Response, timeoutMs = 25_000): Promise<any> {
  const body = res.body;
  if (!body) return {};
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let timedOut = false;

  // Cancel the reader from outside after the deadline so reader.read() resolves
  // with { done: true } and the loop exits cleanly.
  const deadline = setTimeout(() => {
    timedOut = true;
    reader.cancel().catch(() => {});
  }, timeoutMs);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (timedOut) {
          throw new Error(`Website MCP SSE stream timed out after ${timeoutMs / 1000}s — no JSON-RPC result received`);
        }
        break;
      }
      buf += decoder.decode(value, { stream: true });
      // Process every complete line in the buffer.
      let nlIdx: number;
      while ((nlIdx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nlIdx).trim();
        buf = buf.slice(nlIdx + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const msg = JSON.parse(payload);
          if (msg.result !== undefined || msg.error !== undefined) {
            // Got what we need — cancel the stream so the server doesn't keep
            // the TCP connection busy waiting for us to read more.
            reader.cancel().catch(() => {});
            return msg;
          }
        } catch { /* not JSON or not the message we want — keep reading */ }
      }
    }
  } catch (err) {
    if (timedOut) {
      throw new Error(`Website MCP SSE stream timed out after ${timeoutMs / 1000}s — no JSON-RPC result received`);
    }
    throw err;
  } finally {
    clearTimeout(deadline);
    reader.releaseLock();
  }
  return {};
}

/** Parse a Streamable-HTTP response body that is either a plain JSON-RPC
 *  message or an SSE stream carrying one.
 *
 *  IMPORTANT: for SSE, we stream the body line-by-line and return as soon as
 *  we find the JSON-RPC result rather than calling res.text() which blocks
 *  until the server closes the connection (= 30-second hang in production). */
async function parseMcpResponse(res: Response): Promise<any> {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/event-stream")) {
    return parseSSEStream(res);
  }
  // Plain JSON response — safe to buffer.
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { error: { message: text.slice(0, 500) } }; }
}

/** Call a single tool on the tenant's website MCP server. Throws on transport,
 *  auth, or tool errors; records lastUsedAt / lastError on the connection. */
export async function callWebsiteTool<T = any>(
  tenantDomain: string,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const conn = await getWebsiteConnection(tenantDomain);
  if (!conn || !conn.enabled) throw new WebsiteNotConnectedError();

  const apiKey = decryptSecret(conn.encryptedApiKey);
  let result: T;
  try {
    const res = await fetch(conn.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: randomUUID(),
        method: "tools/call",
        params: { name: tool, arguments: args },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Website MCP ${tool} failed (HTTP ${res.status})${body ? `: ${body.slice(0, 300)}` : ""}`);
    }
    const msg = await parseMcpResponse(res);
    if (msg?.error) throw new Error(msg.error.message || `Website MCP ${tool} returned an error`);
    if (msg?.result?.isError) {
      const detail = unwrapToolResult(msg.result);
      throw new Error(typeof detail === "string" ? detail : `Website MCP ${tool} returned an error`);
    }
    // No result and no error means we couldn't recognize the reply (e.g. an SSE
    // body with no JSON-RPC result line). Fail loudly rather than silently
    // returning null and hiding a protocol mismatch.
    if (msg?.result === undefined) {
      throw new Error(`Website MCP ${tool} returned an unrecognized response (no result).`);
    }
    result = unwrapToolResult(msg.result) as T;
  } catch (err) {
    await db.update(websiteConnections)
      .set({ lastError: (err as Error).message?.slice(0, 500) ?? "Unknown error", updatedAt: new Date() })
      .where(eq(websiteConnections.tenantDomain, tenantDomain));
    throw err;
  }

  await db.update(websiteConnections)
    .set({ lastUsedAt: new Date(), lastError: null, updatedAt: new Date() })
    .where(eq(websiteConnections.tenantDomain, tenantDomain));
  return result;
}

// ─── Typed helpers (v1 subset) ───────────────────────────────────────────────

export interface WebsiteAuthor { id: string; displayName: string; avatarUrl?: string; bio?: string }
export interface WebsiteTaxonomy { id: string; name: string; slug: string }
export interface CreateDraftPostParams {
  title: string;
  bodyMarkdown: string;
  authorId: string;
  excerpt?: string;
  categoryIds?: string[];
  tagIds?: string[];
  heroImageId?: string;
  seoTitle?: string;
  seoDescription?: string;
}
export interface CreatedDraftPost { id: string; slug: string; status: string; title: string }
export interface UpdateDraftPostParams {
  id: string;
  title?: string;
  bodyMarkdown?: string;
  excerpt?: string;
  heroImageId?: string | null;
  categoryIds?: string[];
  tagIds?: string[];
  seoTitle?: string | null;
  seoDescription?: string | null;
}
export interface PostPerformance {
  totalViews: number;
  uniqueSessions: number;
  viewsByDay: { date: string; views: number }[];
  topReferrers: { host: string; count: number }[];
}
export interface UploadedMedia { id: string; publicUrl: string; altText: string; mime: string }

export const listAuthors = (tenant: string) => callWebsiteTool<WebsiteAuthor[]>(tenant, "list_authors");
export const listCategories = (tenant: string) => callWebsiteTool<WebsiteTaxonomy[]>(tenant, "list_categories");
export const listTags = (tenant: string) => callWebsiteTool<WebsiteTaxonomy[]>(tenant, "list_tags");
export const createDraftPost = (tenant: string, params: CreateDraftPostParams) =>
  callWebsiteTool<CreatedDraftPost>(tenant, "create_draft_post", params as unknown as Record<string, unknown>);
export const updateDraftPost = (tenant: string, params: UpdateDraftPostParams) =>
  callWebsiteTool<{ id: string; updated: boolean }>(tenant, "update_draft_post", params as unknown as Record<string, unknown>);
export const schedulePost = (tenant: string, id: string, scheduledFor: string) =>
  callWebsiteTool<{ id: string; status: string; scheduledFor: string }>(tenant, "schedule_post", { id, scheduledFor });
export const getPostPerformance = (tenant: string, slug: string) =>
  callWebsiteTool<PostPerformance>(tenant, "get_post_performance", { slug });
export const uploadImage = (
  tenant: string,
  params: { imageData: string; mimeType: string; altText: string; filename?: string; categoryId?: string },
) => callWebsiteTool<UploadedMedia>(tenant, "upload_image", params as unknown as Record<string, unknown>);

// ─── Media library ───────────────────────────────────────────────────────────

export interface WebsiteMediaCategory { id: string; name: string; slug: string }
export interface WebsiteMediaItem {
  id: string;
  filename: string;
  altText?: string;
  type: string;
  publicUrl: string;
  optimizedUrl?: string;
  storageKey?: string;
  categoryId?: string;
  createdAt?: string;
}
export interface WebsiteMediaList {
  items: WebsiteMediaItem[];
  total: number;
  page: number;
  perPage: number;
}

export const listMediaCategories = (tenant: string) =>
  callWebsiteTool<WebsiteMediaCategory[]>(tenant, "list_media_categories");

export const listMedia = (
  tenant: string,
  opts: { categoryId?: string; page?: number; perPage?: number } = {},
) =>
  callWebsiteTool<WebsiteMediaList>(tenant, "list_media", {
    ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
    ...(opts.page !== undefined ? { page: opts.page } : {}),
    ...(opts.perPage !== undefined ? { perPage: opts.perPage } : {}),
  });

export const getMedia = (tenant: string, id: string) =>
  callWebsiteTool<WebsiteMediaItem>(tenant, "get_media", { id });

// ─── Lightweight read used to verify a freshly-saved connection works. ────────
export const pingWebsite = (tenant: string) =>
  callWebsiteTool(tenant, "search_posts", { pageSize: 1 });

/**
 * Unauthenticated connectivity probe — GET <endpoint>/ping.
 * Returns true if the server responds 200, false on any network/non-2xx
 * error, or throws with a descriptive message on auth failure (401/403).
 */
export async function pingMcpServer(tenantDomain: string): Promise<{ ok: boolean; authFailed: boolean; message: string }> {
  const conn = await getWebsiteConnection(tenantDomain);
  if (!conn || !conn.enabled) return { ok: false, authFailed: false, message: "Not connected" };
  const pingUrl = conn.endpoint.replace(/\/api\/mcp\/?$/, "") + "/api/mcp/ping";
  try {
    const res = await fetch(pingUrl, { method: "GET", signal: AbortSignal.timeout(8000) });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, authFailed: true, message: `Server is reachable but returned HTTP ${res.status} — API key is invalid or missing. Generate a new key from the website admin panel (Settings → Access → MCP Keys).` };
    }
    return res.ok
      ? { ok: true, authFailed: false, message: "ok" }
      : { ok: false, authFailed: false, message: `Ping returned HTTP ${res.status}` };
  } catch (err: any) {
    return { ok: false, authFailed: false, message: `Cannot reach website server: ${err?.message ?? "network error"}` };
  }
}

export interface WebsitePostSummary {
  id: string;
  title: string;
  slug: string;
  status: string;
  publishedAt?: string;
  excerpt?: string;
  /** Website returns heroImageUrl (not leadImageUrl). */
  heroImageUrl?: string;
  ogImageUrl?: string;
  /** Content kind derived from categories on the website side.
   *  Values: "post" | "case_study" | "whitepaper" | "video" | "workshop" | "webinar" | "podcast"
   *  Falls back to "post" when the website build predates this field. */
  kind?: string;
  subtitle?: string;
  author?: string;
  readingTimeMin?: number;
}

/** Search published/draft posts on the tenant's website via MCP. */
export const searchPosts = (tenant: string, query?: string, pageSize = 30) =>
  callWebsiteTool<WebsitePostSummary[]>(tenant, "search_posts", {
    ...(query ? { query } : {}),
    pageSize,
  });

/** Fetch posts for import into the content library (up to 50 — website MCP max).
 *  We intentionally omit `status: "published"` because older website plugin builds
 *  don't support that parameter and may hang or return unrecognised SSE frames when
 *  it is present.  The website's search_posts tool returns published posts by default. */
export const searchPublishedPosts = (tenant: string) =>
  callWebsiteTool<WebsitePostSummary[]>(tenant, "search_posts", {
    pageSize: 50,
  });

// ─── Events / conferences ────────────────────────────────────────────────────

export interface WebsiteEventSummary {
  id: string;
  /** Website may return either `name` or `title` — normalised server-side. */
  name?: string;
  title?: string;
  slug?: string;
  startDate?: string;   // ISO date or date-time string
  endDate?: string;
  location?: string;
  timezone?: string;
  eventType?: string;
  registrationStatus?: string;
  url?: string;
  registrationUrl?: string;
  teaser?: string;
  description?: string;
  imageUrl?: string;
}

export interface WebsiteEpisodeSummary {
  id: string;
  slug: string;
  episodeNumber?: number;
  title: string;
  guestName?: string;
  summary?: string;
  durationSeconds?: number;
  audioUrl?: string;
  artworkUrl?: string;
  appleUrl?: string;
  spotifyUrl?: string;
  featured?: boolean;
  publishedAt?: string;
}

export interface WebsiteLandingPageSummary {
  id: string;
  slug: string;
  title: string;
  subtitle?: string;
  description?: string;
  pillar?: string;
  tags?: string[];
  seoTitle?: string;
  seoDescription?: string;
  publishedAt?: string;
  featuredRank?: number;
}

/**
 * List events from the website MCP server.
 * Returns ALL events (past + upcoming) so the import dialog can show the full
 * set — `upcoming: true` is intentionally omitted because older website plugin
 * builds don't support that parameter and silently return nothing.
 * Normalises the `name` vs `title` ambiguity from the spec.
 * Throws on transport/auth errors so callers can surface a real error message.
 */
export async function listEvents(tenant: string, limit = 50): Promise<WebsiteEventSummary[]> {
  const raw = await callWebsiteTool<WebsiteEventSummary[]>(tenant, "list_events", { limit });
  // Normalise: spec says field may be `name` or `title` — ensure `name` is always populated.
  return raw.map(ev => ({ ...ev, name: ev.name ?? ev.title ?? "Unnamed event" }));
}

/**
 * List published podcast episodes (Polaris series) from the website MCP.
 * Returns [] gracefully if the tool is absent on this build.
 */
export async function listEpisodes(tenant: string, limit = 50): Promise<WebsiteEpisodeSummary[]> {
  try {
    return await callWebsiteTool<WebsiteEpisodeSummary[]>(tenant, "list_episodes", { limit });
  } catch {
    return [];
  }
}

/**
 * List published landing pages from the website MCP.
 * Returns [] gracefully if the tool is absent on this build.
 */
export async function listLandingPages(tenant: string, limit = 50): Promise<WebsiteLandingPageSummary[]> {
  try {
    return await callWebsiteTool<WebsiteLandingPageSummary[]>(tenant, "list_landing_pages", { limit });
  } catch {
    return [];
  }
}

/** Reject non-HTTPS and localhost / private / link-local hosts so a server-side
 *  image fetch can't be turned into an SSRF probe of the internal network. */
function isSafePublicHttpsUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  // IPv4 private / loopback / link-local ranges + IPv6 loopback.
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false;
  if (host === "::1" || host === "[::1]") return false;
  return true;
}

/** Fetch an image URL and return base64 bytes + mime, for upload_image. Returns
 *  null if the URL is unsafe, can't be fetched, or isn't an image (hero upload
 *  is best-effort and never blocks the post). */
export async function fetchImageAsBase64(url: string): Promise<{ imageData: string; mimeType: string } | null> {
  if (!isSafePublicHttpsUrl(url)) return null;
  try {
    const res = await fetch(url, { redirect: "error" });
    if (!res.ok) return null;
    const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
    if (!mimeType.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > 10 * 1024 * 1024) return null; // skip empty / >10MB
    return { imageData: buf.toString("base64"), mimeType };
  } catch {
    return null;
  }
}
