/**
 * HubSpot CRM Integration (Task #100)
 *
 * Per-tenant OAuth-based HubSpot integration. One connection per Orbit
 * tenant; tokens are encrypted at rest using server/utils/encryption.ts
 * (same helper as the LinkedIn social publisher).
 *
 * Required env vars (request via the environment-secrets skill):
 *   - HUBSPOT_CLIENT_ID
 *   - HUBSPOT_CLIENT_SECRET
 *
 * The redirect URI is derived from the request host so that this works
 * across dev, staging and production without an extra env var.
 *
 * High-level surface:
 *   - getAuthorizeUrl(tenantDomain, state, redirectUri)
 *   - exchangeCode(code, redirectUri)
 *   - getTenantClient(tenantDomain)            ← auto-refreshes tokens
 *   - syncTenant(tenantDomain)                 ← inbound enrichment + deal rollup
 *   - listSuggestedCompetitors(tenantDomain)   ← top CRM companies not yet tracked
 *   - pushBattlecardNote(tenantDomain, competitorId, html, sourceUrl)
 *   - pushBriefingNote(tenantDomain, competitorId, html, sourceUrl)
 *   - pushActionItemTask(tenantDomain, opts)
 *   - listOwners(tenantDomain)
 *
 * Plan gating is enforced at the route layer via `guardFeature("hubspotIntegration")`.
 * Outbound (notes / tasks / auto-push) is additionally gated on
 * `isHubspotOutboundAllowed(plan)` — Pro = inbound only, Enterprise/Unlimited = full.
 */

import { Client } from "@hubspot/api-client";
import {
  AssociationSpecAssociationCategoryEnum,
  FilterOperatorEnum,
} from "@hubspot/api-client/lib/codegen/crm/companies";
import { storage } from "../storage";
import { encryptSecret, decryptSecret } from "../utils/encryption";
import { HUBSPOT_OAUTH_SCOPES, type HubspotConnection } from "@shared/schema";
import { normalizePlanName } from "./plan-policy";

// HubSpot association type IDs (HUBSPOT_DEFINED).
// 190 = Note → Company; 192 = Task → Company; 202 = Note → Contact.
const ASSOC_NOTE_TO_COMPANY = 190;
const ASSOC_TASK_TO_COMPANY = 192;
const ASSOC_NOTE_TO_CONTACT = 202;

const HUBSPOT_AUTH_HOST = "https://app.hubspot.com";
const HUBSPOT_API_HOST = "https://api.hubapi.com";

// Cap how many HubSpot Companies we fetch per sync. The task spec says
// "the inbound sync only touches companies that match an existing
// competitor by domain plus a small suggested-competitors preview list
// capped at 50".
const SUGGESTED_LIMIT = 50;
const COMPANY_PAGE_LIMIT = 100;
const DEAL_PAGE_LIMIT = 100;

export function isHubspotOauthConfigured(): boolean {
  return !!(process.env.HUBSPOT_CLIENT_ID && process.env.HUBSPOT_CLIENT_SECRET);
}

export function isHubspotOutboundAllowed(plan: string): boolean {
  const p = normalizePlanName(plan);
  return p === "enterprise" || p === "unlimited";
}

export function getRequiredScopes(): string {
  return HUBSPOT_OAUTH_SCOPES.join(" ");
}

export function getAuthorizeUrl(state: string, redirectUri: string): string {
  if (!isHubspotOauthConfigured()) {
    throw new Error("HubSpot OAuth not configured: missing HUBSPOT_CLIENT_ID/SECRET");
  }
  const params = new URLSearchParams({
    client_id: process.env.HUBSPOT_CLIENT_ID!,
    redirect_uri: redirectUri,
    scope: getRequiredScopes(),
    state,
  });
  return `${HUBSPOT_AUTH_HOST}/oauth/authorize?${params.toString()}`;
}

interface HubspotTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

interface HubspotTokenInfo {
  hub_id?: number | string;
  hub_domain?: string;
  user_id?: number;
  user?: string;
  scopes?: string[];
  expires_in?: number;
}

export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<{ tokens: HubspotTokenResponse; info: HubspotTokenInfo }> {
  if (!isHubspotOauthConfigured()) {
    throw new Error("HubSpot OAuth not configured");
  }
  const tokRes = await fetch(`${HUBSPOT_API_HOST}/oauth/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.HUBSPOT_CLIENT_ID!,
      client_secret: process.env.HUBSPOT_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      code,
    }).toString(),
  });
  if (!tokRes.ok) {
    const txt = await tokRes.text().catch(() => "");
    throw new Error(`HubSpot token exchange failed: ${tokRes.status} ${txt}`);
  }
  const tokens = (await tokRes.json()) as HubspotTokenResponse;
  const info = await fetchTokenInfo(tokens.access_token);
  return { tokens, info };
}

async function fetchTokenInfo(accessToken: string): Promise<HubspotTokenInfo> {
  const res = await fetch(`${HUBSPOT_API_HOST}/oauth/v1/access-tokens/${encodeURIComponent(accessToken)}`);
  if (!res.ok) {
    return {};
  }
  return (await res.json()) as HubspotTokenInfo;
}

async function refreshAccessToken(connection: HubspotConnection): Promise<HubspotConnection> {
  if (!isHubspotOauthConfigured()) {
    throw new Error("HubSpot OAuth not configured — cannot refresh token");
  }
  let refreshToken: string;
  try {
    refreshToken = decryptSecret(connection.encryptedRefreshToken);
  } catch {
    throw new Error("Stored HubSpot refresh token could not be decrypted — please reconnect.");
  }
  const res = await fetch(`${HUBSPOT_API_HOST}/oauth/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.HUBSPOT_CLIENT_ID!,
      client_secret: process.env.HUBSPOT_CLIENT_SECRET!,
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HubSpot token refresh failed: ${res.status} ${txt}`);
  }
  const tokens = (await res.json()) as HubspotTokenResponse;
  const expiresAt = new Date(Date.now() + (tokens.expires_in - 60) * 1000);
  const updated = await storage.updateHubspotConnection(connection.tenantDomain, {
    encryptedAccessToken: encryptSecret(tokens.access_token),
    encryptedRefreshToken: encryptSecret(tokens.refresh_token),
    expiresAt,
  });
  return updated;
}

/**
 * Returns an authenticated HubSpot Client scoped to the tenant. Refreshes
 * the access token first if it expires within the next 60 seconds. Throws
 * with a friendly message when the tenant has no connection.
 */
export async function getTenantClient(tenantDomain: string): Promise<{ client: Client; connection: HubspotConnection }> {
  let conn = await storage.getHubspotConnection(tenantDomain);
  if (!conn) {
    throw new Error("HubSpot is not connected for this tenant.");
  }
  if (conn.expiresAt.getTime() - 60_000 <= Date.now()) {
    conn = await refreshAccessToken(conn);
  }
  let accessToken: string;
  try {
    accessToken = decryptSecret(conn.encryptedAccessToken);
  } catch {
    throw new Error("Stored HubSpot access token could not be decrypted — please reconnect.");
  }
  return { client: new Client({ accessToken }), connection: conn };
}

/**
 * Returns a refreshed raw access token for the tenant alongside the
 * connection. Used by sync paths that call HubSpot REST endpoints the SDK
 * doesn't model yet (e.g. the 2026-03 subscriptions / communication-
 * preferences API). Shares the same refresh-if-expiring logic as
 * getTenantClient().
 */
export async function getTenantAccessToken(
  tenantDomain: string,
): Promise<{ accessToken: string; connection: HubspotConnection }> {
  let conn = await storage.getHubspotConnection(tenantDomain);
  if (!conn) {
    throw new Error("HubSpot is not connected for this tenant.");
  }
  if (conn.expiresAt.getTime() - 60_000 <= Date.now()) {
    conn = await refreshAccessToken(conn);
  }
  let accessToken: string;
  try {
    accessToken = decryptSecret(conn.encryptedAccessToken);
  } catch {
    throw new Error("Stored HubSpot access token could not be decrypted — please reconnect.");
  }
  return { accessToken, connection: conn };
}

/**
 * Whether a connection has been authorized with the marketing-email sync
 * scopes (timeline + communication preferences). Connections created before
 * these scopes were added will be missing them until the tenant re-consents;
 * sync paths check this and no-op when false so the rest of the integration
 * keeps working. We check the locally-recorded scopes (set at connect time)
 * rather than calling HubSpot.
 */
export function hasHubspotEmailScopes(connection: Pick<HubspotConnection, "scopes">): boolean {
  const granted = new Set((connection.scopes ?? []).map((s) => s.trim()));
  return (
    granted.has("communication_preferences.read") &&
    granted.has("communication_preferences.write") &&
    granted.has("timeline")
  );
}

export function hasHubspotListScopes(connection: Pick<HubspotConnection, "scopes">): boolean {
  const granted = new Set((connection.scopes ?? []).map((s) => s.trim()));
  return granted.has("crm.lists.read");
}

export const HUBSPOT_REST_HOST = HUBSPOT_API_HOST;

// ─────────────────────────────────────────────────────────────────────────
// Inbound: enrichment + deal rollup
// ─────────────────────────────────────────────────────────────────────────

interface SyncStats {
  matched: number;
  enriched: number;
  dealsAggregated: number;
  errors: number;
}

function rootDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  s = s.split("/")[0];
  s = s.split("?")[0];
  if (!s) return null;
  return s;
}

export async function syncTenant(tenantDomain: string): Promise<SyncStats> {
  const stats: SyncStats = { matched: 0, enriched: 0, dealsAggregated: 0, errors: 0 };
  const { client } = await getTenantClient(tenantDomain);

  const competitors = await storage.getCompetitorsByTenantDomain(tenantDomain);
  if (competitors.length === 0) {
    await storage.markHubspotSyncResult(tenantDomain, { stats, error: null });
    return stats;
  }

  // Build a map of every domain AND name we want to look up. We try the
  // `website` field to be tolerant of competitors entered with a full URL,
  // and we also match by the company name as a fallback so competitors
  // without a matching domain still get linked.
  const domainToCompetitorId = new Map<string, string>();
  const nameToCompetitorId = new Map<string, string>();
  for (const c of competitors) {
    const candidates = [c.url, (c as Record<string, unknown>).domain, (c as Record<string, unknown>).website]
      .filter((v): v is string => typeof v === "string" && v.length > 0);
    for (const raw of candidates) {
      const d = rootDomain(raw);
      if (d) domainToCompetitorId.set(d, c.id);
    }
    if (c.name) nameToCompetitorId.set(c.name.trim().toLowerCase(), c.id);
  }
  const domains = Array.from(domainToCompetitorId.keys());
  const names = Array.from(nameToCompetitorId.keys());
  if (domains.length === 0 && names.length === 0) {
    await storage.markHubspotSyncResult(tenantDomain, { stats, error: null });
    return stats;
  }

  const processedCompanyIds = new Set<string>();
  type HsCompany = { id?: string; properties?: unknown };
  const COMPANY_PROPS = ["domain", "name", "industry", "annualrevenue", "numberofemployees", "lifecyclestage"];

  async function processCompany(co: HsCompany, competitorId: string): Promise<void> {
    if (!co.id || processedCompanyIds.has(co.id)) return;
    processedCompanyIds.add(co.id);
    const props = (co.properties as Record<string, string>) || {};

    // Roll up only deals where this company is associated AS A COMPETITOR
    // (labeled association whose label contains "competitor"), OR where
    // a deal property explicitly identifies this company as a competitor
    // (best-effort against `hs_competitor_company_id`). Deals where the
    // company is just the buyer (default association) are excluded.
    let openDealCount = 0;
    let openDealValue = 0;
    const seenDealIds = new Set<string>();
    try {
      const competitorDealIds: string[] = [];
      let after: string | undefined = undefined;
      for (let page = 0; page < 5; page++) {
        const assocRes = (await (client.crm.associations.v4 as unknown as {
          basicApi: {
            getPage: (
              fromType: string,
              fromId: string,
              toType: string,
              after?: string,
              limit?: number,
            ) => Promise<{
              results?: Array<{
                toObjectId: string;
                associationTypes?: Array<{ label?: string | null; category?: string }>;
              }>;
              paging?: { next?: { after?: string } };
            }>;
          };
        }).basicApi.getPage("companies", co.id, "deals", after, 500));
        for (const row of assocRes.results || []) {
          const isCompetitor = (row.associationTypes || []).some(
            (t) => typeof t.label === "string" && t.label.toLowerCase().includes("competitor"),
          );
          if (isCompetitor) competitorDealIds.push(String(row.toObjectId));
        }
        after = assocRes.paging?.next?.after;
        if (!after) break;
      }
      // Fallback: deals with a competitor-property field referencing this
      // company. Tolerated when the property does not exist on the portal.
      try {
        const propRes = await client.crm.deals.searchApi.doSearch({
          filterGroups: [
            { filters: [{ propertyName: "hs_competitor_company_id", operator: FilterOperatorEnum.Eq, value: co.id }] },
          ],
          properties: ["amount", "dealstage", "hs_is_closed"],
          limit: DEAL_PAGE_LIMIT,
          after: "0",
          sorts: [],
        });
        for (const d of propRes.results) {
          if (d.id) competitorDealIds.push(String(d.id));
        }
      } catch {
        /* property does not exist on this portal — that's fine */
      }
      stats.dealsAggregated += competitorDealIds.length;
      for (let i = 0; i < competitorDealIds.length; i += 100) {
        const slice = competitorDealIds.slice(i, i + 100);
        const dealRes = await client.crm.deals.searchApi.doSearch({
          filterGroups: [
            { filters: [{ propertyName: "hs_object_id", operator: FilterOperatorEnum.In, values: slice }] },
          ],
          properties: ["amount", "dealstage", "pipeline", "hs_is_closed"],
          limit: DEAL_PAGE_LIMIT,
          after: "0",
          sorts: [],
        });
        for (const d of dealRes.results) {
          if (d.id && seenDealIds.has(String(d.id))) continue;
          if (d.id) seenDealIds.add(String(d.id));
          const dp = (d.properties as Record<string, string>) || {};
          if (dp.hs_is_closed === "true") continue;
          openDealCount += 1;
          const amt = parseFloat(dp.amount || "0");
          if (!Number.isNaN(amt)) openDealValue += Math.round(amt);
        }
      }
    } catch (err) {
      stats.errors += 1;
      console.warn(
        `[HubSpot Sync] competitor-deal rollup failed for company ${co.id}:`,
        (err as Error)?.message || err,
      );
    }

    const updates: Record<string, unknown> = {
      hubspotCompanyId: co.id,
      hubspotLifecycleStage: props.lifecyclestage || null,
      hubspotOpenDealCount: openDealCount,
      hubspotOpenDealValue: openDealValue,
      hubspotLastSyncAt: new Date(),
    };
    if (props.industry) updates.industry = props.industry;
    if (props.numberofemployees) updates.employeeCount = props.numberofemployees;
    if (props.annualrevenue) updates.revenue = props.annualrevenue;

    try {
      await storage.updateCompetitor(competitorId, updates);
      stats.matched += 1;
      if (props.industry || props.numberofemployees || props.annualrevenue || props.lifecyclestage) {
        stats.enriched += 1;
      }
    } catch (err) {
      stats.errors += 1;
      console.error(
        `[HubSpot Sync] update competitor ${competitorId} failed:`,
        (err as Error)?.message || err,
      );
    }
  }

  // Pass 1 — domain match
  for (let i = 0; i < domains.length; i += 100) {
    const slice = domains.slice(i, i + 100);
    try {
      const result = await client.crm.companies.searchApi.doSearch({
        filterGroups: [
          { filters: [{ propertyName: "domain", operator: FilterOperatorEnum.In, values: slice }] },
        ],
        properties: COMPANY_PROPS,
        limit: COMPANY_PAGE_LIMIT,
        after: "0",
        sorts: [],
      });
      for (const co of result.results) {
        const props = (co.properties as Record<string, string>) || {};
        const dom = rootDomain(props.domain);
        if (!dom) continue;
        const competitorId = domainToCompetitorId.get(dom);
        if (!competitorId) continue;
        await processCompany(co, competitorId);
      }
    } catch (err) {
      stats.errors += 1;
      console.error(
        `[HubSpot Sync] company domain-search failed for ${tenantDomain}:`,
        (err as Error)?.message || err,
      );
    }
  }

  // Pass 2 — name match for competitors that didn't match by domain.
  // HubSpot search "name" only supports equality / contains_token; we use
  // contains_token (case-insensitive) per name and accept exact-name
  // matches client-side to avoid false positives.
  for (const name of names) {
    try {
      const result = await client.crm.companies.searchApi.doSearch({
        filterGroups: [
          { filters: [{ propertyName: "name", operator: FilterOperatorEnum.ContainsToken, value: name }] },
        ],
        properties: COMPANY_PROPS,
        limit: COMPANY_PAGE_LIMIT,
        after: "0",
        sorts: [],
      });
      for (const co of result.results) {
        const props = (co.properties as Record<string, string>) || {};
        const hsName = (props.name || "").trim().toLowerCase();
        if (!hsName) continue;
        if (hsName !== name && !hsName.includes(name) && !name.includes(hsName)) continue;
        const competitorId = nameToCompetitorId.get(name);
        if (!competitorId) continue;
        await processCompany(co, competitorId);
      }
    } catch (err) {
      stats.errors += 1;
      console.warn(
        `[HubSpot Sync] company name-search failed for ${tenantDomain}:`,
        (err as Error)?.message || err,
      );
    }
  }

  await storage.markHubspotSyncResult(tenantDomain, { stats, error: null });
  return stats;
}

// ─────────────────────────────────────────────────────────────────────────
// Suggested competitors — top HubSpot Companies the tenant deals with
// that are NOT in Orbit's competitor list.
// ─────────────────────────────────────────────────────────────────────────

export interface SuggestedCompetitor {
  hubspotCompanyId: string;
  name: string;
  domain: string | null;
  industry: string | null;
  numberOfDeals: number;
  totalDealValue: number;
}

export async function listSuggestedCompetitors(tenantDomain: string): Promise<SuggestedCompetitor[]> {
  const { client } = await getTenantClient(tenantDomain);
  const competitors = await storage.getCompetitorsByTenantDomain(tenantDomain);
  const trackedDomains = new Set<string>();
  const trackedHubspotIds = new Set<string>();
  for (const c of competitors) {
    const candidates = [c.url, (c as any).domain, (c as any).website].filter(Boolean) as string[];
    for (const raw of candidates) {
      const d = rootDomain(raw);
      if (d) trackedDomains.add(d);
    }
    if (c.hubspotCompanyId) trackedHubspotIds.add(c.hubspotCompanyId);
  }

  // Fetch top companies by num_associated_deals desc.
  const result = await client.crm.companies.searchApi.doSearch({
    filterGroups: [
      { filters: [{ propertyName: "num_associated_deals", operator: FilterOperatorEnum.Gt, value: "0" }] },
    ],
    properties: ["domain", "name", "industry", "num_associated_deals", "total_revenue"],
    sorts: ["num_associated_deals"],
    limit: SUGGESTED_LIMIT,
    after: "0",
  });

  const out: SuggestedCompetitor[] = [];
  for (const co of result.results) {
    const props = (co.properties as Record<string, string>) || {};
    const dom = rootDomain(props.domain);
    if (dom && trackedDomains.has(dom)) continue;
    if (trackedHubspotIds.has(co.id)) continue;
    out.push({
      hubspotCompanyId: co.id,
      name: props.name || dom || `HubSpot Company ${co.id}`,
      domain: dom,
      industry: props.industry || null,
      numberOfDeals: parseInt(props.num_associated_deals || "0", 10) || 0,
      totalDealValue: Math.round(parseFloat(props.total_revenue || "0") || 0),
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Sales outreach: two-way contact sync (pull existing contacts, push prospects)
// ─────────────────────────────────────────────────────────────────────────

export interface HubspotContactLite {
  hubspotContactId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  name: string;
  jobTitle: string | null;
  company: string | null;
  linkedinUrl: string | null;
}

const CONTACT_PROPS = ["firstname", "lastname", "email", "jobtitle", "company", "hs_linkedin_url"];

function contactName(props: Record<string, string>): string {
  const n = [props.firstname, props.lastname].filter(Boolean).join(" ").trim();
  return n || props.email || "Unknown contact";
}

export interface HubspotListSummary {
  listId: string;
  name: string;
  memberCount: number;
}

/**
 * Fetch all CRM contact lists from the tenant's HubSpot, sorted by name.
 * Uses the v3 Lists API (objectTypeId 0-1 = contacts).
 */
export async function listHubspotContactLists(tenantDomain: string): Promise<HubspotListSummary[]> {
  // Use raw fetch instead of the SDK's listsApi.getAll() — the SDK codegen
  // mismatches positional vs. options-object calling convention and throws
  // "data is not iterable" inside ObjectSerializer during request serialization.
  const { accessToken } = await getTenantAccessToken(tenantDomain);
  const url = "https://api.hubapi.com/crm/v3/lists?objectTypeId=0-1&count=250&includeFilters=false";
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`HubSpot lists API error ${res.status}: ${txt}`);
  }
  const data: any = await res.json();
  const lists: any[] = data?.lists ?? [];
  return lists
    .map((l: any) => ({
      listId: String(l.listId),
      name: (l.name as string) || "(unnamed list)",
      memberCount: (l.memberCount as number) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Fetch the first `limit` contacts that are members of a given HubSpot list,
 * returning the same HubspotContactLite shape as listContacts().
 */
export async function listContactsFromHubspotList(
  tenantDomain: string,
  listId: string,
  limit = 100,
): Promise<HubspotContactLite[]> {
  const { client } = await getTenantClient(tenantDomain);
  const cap = Math.min(Math.max(limit, 1), 200);

  // Step 1: get member record IDs.
  const membersResult = await (client.crm.lists as any).membershipsApi.getPage(
    listId,
    undefined, // after
    undefined, // before
    cap,
  );
  const recordIds: string[] = (membersResult?.results ?? []).map((r: any) => String(r.recordId));
  if (recordIds.length === 0) return [];

  // Step 2: batch-read contact details for those IDs.
  const batchResult = await (client.crm.contacts.batchApi as any).read({
    inputs: recordIds.map((id) => ({ id })),
    properties: CONTACT_PROPS,
    propertiesWithHistory: [],
  });

  return (batchResult.results ?? []).map((c: any) => {
    const props = (c.properties as Record<string, string>) || {};
    return {
      hubspotContactId: c.id,
      email: props.email || null,
      firstName: props.firstname || null,
      lastName: props.lastname || null,
      name: contactName(props),
      jobTitle: props.jobtitle || null,
      company: props.company || null,
      linkedinUrl: props.hs_linkedin_url || null,
    };
  });
}

/**
 * Pull contacts from the tenant's HubSpot to seed prospects. With `query`,
 * searches first/last/email/company; otherwise returns the most recently
 * modified contacts.
 */
export async function listContacts(
  tenantDomain: string,
  opts: { query?: string; limit?: number } = {},
): Promise<HubspotContactLite[]> {
  const { client } = await getTenantClient(tenantDomain);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const q = (opts.query ?? "").trim();

  const result = await client.crm.contacts.searchApi.doSearch({
    query: q || undefined,
    filterGroups: [],
    properties: CONTACT_PROPS,
    sorts: ["lastmodifieddate"],
    limit,
    after: "0",
  } as any);

  return result.results.map((c) => {
    const props = (c.properties as Record<string, string>) || {};
    return {
      hubspotContactId: c.id,
      email: props.email || null,
      firstName: props.firstname || null,
      lastName: props.lastname || null,
      name: contactName(props),
      jobTitle: props.jobtitle || null,
      company: props.company || null,
      linkedinUrl: props.hs_linkedin_url || null,
    };
  });
}

/**
 * Create or update a contact in HubSpot from an outreach prospect. Dedupes by
 * email when present. Returns the HubSpot contact id.
 */
export async function upsertContact(
  tenantDomain: string,
  c: { email?: string | null; firstName?: string | null; lastName?: string | null; jobTitle?: string | null; company?: string | null },
): Promise<string> {
  const { client } = await getTenantClient(tenantDomain);
  const properties: Record<string, string> = {};
  if (c.email) properties.email = c.email;
  if (c.firstName) properties.firstname = c.firstName;
  if (c.lastName) properties.lastname = c.lastName;
  if (c.jobTitle) properties.jobtitle = c.jobTitle;
  if (c.company) properties.company = c.company;

  // Find existing by email first (avoids duplicate contacts).
  if (c.email) {
    const found = await client.crm.contacts.searchApi.doSearch({
      filterGroups: [{ filters: [{ propertyName: "email", operator: FilterOperatorEnum.Eq, value: c.email }] }],
      properties: ["email"],
      limit: 1,
      after: "0",
    } as any);
    if (found.results.length > 0) {
      const id = found.results[0].id;
      await client.crm.contacts.basicApi.update(id, { properties });
      return id;
    }
  }
  const created = await client.crm.contacts.basicApi.create({ properties, associations: [] });
  return created.id;
}

/** Log a note against a HubSpot contact (e.g. "outreach approved"). */
export async function logContactNote(
  tenantDomain: string,
  hubspotContactId: string,
  html: string,
): Promise<{ noteId: string }> {
  const { client } = await getTenantClient(tenantDomain);
  const note = await client.crm.objects.notes.basicApi.create({
    properties: { hs_note_body: html, hs_timestamp: Date.now().toString() },
    associations: [
      {
        to: { id: hubspotContactId },
        types: [{ associationCategory: AssociationSpecAssociationCategoryEnum.HubspotDefined, associationTypeId: ASSOC_NOTE_TO_CONTACT }],
      },
    ],
  });
  return { noteId: note.id };
}

// ─────────────────────────────────────────────────────────────────────────
// Outbound: push Note / Task to HubSpot
// ─────────────────────────────────────────────────────────────────────────

export async function pushNoteToCompany(
  tenantDomain: string,
  hubspotCompanyId: string,
  html: string,
): Promise<{ noteId: string }> {
  const { client } = await getTenantClient(tenantDomain);
  const note = await client.crm.objects.notes.basicApi.create({
    properties: {
      hs_note_body: html,
      hs_timestamp: Date.now().toString(),
    },
    associations: [
      {
        to: { id: hubspotCompanyId },
        types: [{
          associationCategory: AssociationSpecAssociationCategoryEnum.HubspotDefined,
          associationTypeId: ASSOC_NOTE_TO_COMPANY,
        }],
      },
    ],
  });
  return { noteId: note.id };
}

export interface PushTaskOptions {
  hubspotCompanyId?: string | null;
  ownerId?: string | null;
  subject: string;
  body: string;
  dueAt?: Date | null;
}

export async function pushTask(
  tenantDomain: string,
  opts: PushTaskOptions,
): Promise<{ taskId: string }> {
  const { client, connection } = await getTenantClient(tenantDomain);
  const ownerId = opts.ownerId ?? connection.defaultOwnerId ?? null;

  const properties: Record<string, string> = {
    hs_task_subject: opts.subject,
    hs_task_body: opts.body,
    hs_task_status: "NOT_STARTED",
    hs_task_priority: "MEDIUM",
    hs_timestamp: (opts.dueAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000)).getTime().toString(),
  };
  if (ownerId) properties.hubspot_owner_id = ownerId;

  const associations = opts.hubspotCompanyId
    ? [{
        to: { id: opts.hubspotCompanyId },
        types: [{
          associationCategory: AssociationSpecAssociationCategoryEnum.HubspotDefined,
          associationTypeId: ASSOC_TASK_TO_COMPANY,
        }],
      }]
    : [];

  const task = await client.crm.objects.tasks.basicApi.create({
    properties,
    associations,
  });
  return { taskId: task.id };
}

export async function listOwners(
  tenantDomain: string,
): Promise<Array<{ id: string; email: string | null; name: string | null }>> {
  const { client } = await getTenantClient(tenantDomain);
  const res = await client.crm.owners.ownersApi.getPage(undefined, undefined, 100);
  return res.results.map((o) => ({
    id: o.id ?? "",
    email: o.email ?? null,
    name: [o.firstName, o.lastName].filter(Boolean).join(" ") || null,
  })).filter((o) => o.id);
}

export async function disconnectTenant(tenantDomain: string): Promise<void> {
  const conn = await storage.getHubspotConnection(tenantDomain);
  if (!conn) return;
  // Best-effort: revoke refresh token on HubSpot side
  try {
    const refreshToken = decryptSecret(conn.encryptedRefreshToken);
    await fetch(`${HUBSPOT_API_HOST}/oauth/v1/refresh-tokens/${encodeURIComponent(refreshToken)}`, {
      method: "DELETE",
    }).catch(() => null);
  } catch {
    /* ignore — primary goal is to drop the row locally */
  }
  await storage.deleteHubspotConnection(tenantDomain);
}

export function buildBattlecardNoteHtml(opts: {
  competitorName: string;
  strengths?: string[] | null;
  weaknesses?: string[] | null;
  ourAdvantages?: string[] | null;
  deepLink: string;
}): string {
  const list = (label: string, items?: string[] | null) => {
    if (!items || items.length === 0) return "";
    const lis = items.slice(0, 8).map((s) => `<li>${escapeHtml(s)}</li>`).join("");
    return `<p><strong>${label}</strong></p><ul>${lis}</ul>`;
  };
  return `
    <div>
      <p><strong>Orbit battlecard — ${escapeHtml(opts.competitorName)}</strong></p>
      ${list("Strengths", opts.strengths)}
      ${list("Weaknesses", opts.weaknesses)}
      ${list("Our advantages", opts.ourAdvantages)}
      <p><a href="${escapeHtml(opts.deepLink)}">Open the full battlecard in Orbit</a></p>
    </div>
  `.trim();
}

export function buildBriefingNoteHtml(opts: {
  title: string;
  summary: string;
  deepLink: string;
}): string {
  return `
    <div>
      <p><strong>Orbit intelligence briefing — ${escapeHtml(opts.title)}</strong></p>
      <p>${escapeHtml(opts.summary).slice(0, 4000)}</p>
      <p><a href="${escapeHtml(opts.deepLink)}">Read the full briefing in Orbit</a></p>
    </div>
  `.trim();
}

/**
 * Resolve the canonical public app URL used for deep links from HubSpot
 * Notes/Tasks back to Orbit. Falls back to a relative path if no URL is
 * configured (HubSpot will still render it).
 */
function appBaseUrl(): string {
  const raw = process.env.PUBLIC_APP_URL || "";
  return raw.replace(/\/+$/, "");
}

/**
 * Best-effort outbound push of a generated battlecard to HubSpot. Silently
 * no-ops when the integration isn't connected, the tenant lacks an
 * outbound-eligible plan, the competitor has no matched HubSpot Company,
 * or auto-push is disabled. Errors are logged but never thrown.
 */
export async function autoPushBattlecard(opts: {
  tenantDomain: string;
  competitorId: string;
  competitorName: string;
  battlecardId: string;
  strengths?: string[] | null;
  weaknesses?: string[] | null;
  ourAdvantages?: string[] | null;
  planName: string;
  /** When true (manual user action), bypass the autoPushEnabled toggle. */
  force?: boolean;
}): Promise<{ pushed: boolean; noteId?: string; reason?: string }> {
  try {
    if (!isHubspotOutboundAllowed(opts.planName)) return { pushed: false, reason: "plan_not_eligible" };
    const conn = await storage.getHubspotConnection(opts.tenantDomain);
    if (!conn) return { pushed: false, reason: "not_connected" };
    if (!conn.autoPushEnabled && !opts.force) return { pushed: false, reason: "auto_push_disabled" };
    const competitor = await storage.getCompetitor(opts.competitorId);
    if (!competitor || !competitor.hubspotCompanyId) return { pushed: false, reason: "no_hubspot_company" };

    const html = buildBattlecardNoteHtml({
      competitorName: opts.competitorName,
      strengths: opts.strengths,
      weaknesses: opts.weaknesses,
      ourAdvantages: opts.ourAdvantages,
      deepLink: `${appBaseUrl()}/app/competitors/${opts.competitorId}?battlecard=${encodeURIComponent(opts.battlecardId)}`,
    });
    const { noteId } = await pushNoteToCompany(opts.tenantDomain, competitor.hubspotCompanyId, html);
    console.log(`[HubSpot] Auto-pushed battlecard tenant=${opts.tenantDomain} competitor=${opts.competitorId} note=${noteId}`);
    return { pushed: true, noteId };
  } catch (err: any) {
    console.warn(`[HubSpot] autoPushBattlecard failed for tenant=${opts.tenantDomain} competitor=${opts.competitorId}:`, err?.message || err);
    return { pushed: false, reason: "error" };
  }
}

/**
 * Best-effort outbound push of a published intelligence briefing. Iterates
 * the briefing's related competitors and creates a Note on each matched
 * HubSpot Company. No-ops when integration isn't connected, plan ineligible,
 * or auto-push disabled.
 */
export interface BriefingActionItemPush {
  title: string;
  rationale?: string;
  priority?: string;
  dueAt?: Date | null;
  competitorId?: string | null;
}

export async function autoPushBriefing(opts: {
  tenantDomain: string;
  briefingId: string;
  title: string;
  executiveSummary: string;
  competitorIds: string[];
  actionItems?: BriefingActionItemPush[];
  planName: string;
  /** When true (manual user action), bypass the autoPushEnabled toggle. */
  force?: boolean;
}): Promise<{ pushed: number; skipped: number; tasksPushed: number; reason?: string }> {
  try {
    if (!isHubspotOutboundAllowed(opts.planName)) return { pushed: 0, skipped: 0, tasksPushed: 0, reason: "plan_not_eligible" };
    const conn = await storage.getHubspotConnection(opts.tenantDomain);
    if (!conn) return { pushed: 0, skipped: 0, tasksPushed: 0, reason: "not_connected" };
    if (!conn.autoPushEnabled && !opts.force) return { pushed: 0, skipped: 0, tasksPushed: 0, reason: "auto_push_disabled" };

    const html = buildBriefingNoteHtml({
      title: opts.title,
      summary: opts.executiveSummary,
      deepLink: `${appBaseUrl()}/app/intelligence?id=${encodeURIComponent(opts.briefingId)}`,
    });
    let pushed = 0;
    let skipped = 0;
    for (const competitorId of opts.competitorIds) {
      try {
        const c = await storage.getCompetitor(competitorId);
        if (!c || c.tenantDomain !== opts.tenantDomain || !c.hubspotCompanyId) {
          skipped += 1;
          continue;
        }
        await pushNoteToCompany(opts.tenantDomain, c.hubspotCompanyId, html);
        pushed += 1;
      } catch (err: any) {
        skipped += 1;
        console.warn(`[HubSpot] briefing push failed for competitor=${competitorId}:`, err?.message || err);
      }
    }

    // Push each action item as a HubSpot Task. If the action item has a
    // related competitor with a matched HubSpot Company, the Task is
    // associated with that company; otherwise it's a standalone Task.
    let tasksPushed = 0;
    const items = opts.actionItems || [];
    for (const item of items) {
      try {
        let companyId: string | null = null;
        if (item.competitorId) {
          const c = await storage.getCompetitor(item.competitorId);
          if (c?.tenantDomain === opts.tenantDomain) companyId = c.hubspotCompanyId ?? null;
        }
        const body = [
          item.rationale || "",
          item.priority ? `\nPriority: ${item.priority}` : "",
          `\n\nFrom Orbit briefing: ${appBaseUrl()}/app/intelligence?id=${encodeURIComponent(opts.briefingId)}`,
        ].join("");
        await pushTask(opts.tenantDomain, {
          hubspotCompanyId: companyId,
          subject: item.title.slice(0, 500),
          body,
          dueAt: item.dueAt ?? null,
        });
        tasksPushed += 1;
      } catch (err: any) {
        console.warn(`[HubSpot] action-item task push failed:`, err?.message || err);
      }
    }

    console.log(`[HubSpot] Auto-pushed briefing tenant=${opts.tenantDomain} briefing=${opts.briefingId} notes=${pushed} skipped=${skipped} tasks=${tasksPushed}`);

    // Task #112: persist push status on the briefing so the UI can render a
    // "Pushed to HubSpot" indicator. Only mark as pushed when at least one
    // Note landed on a HubSpot Company.
    try {
      const pushedAt = pushed > 0 ? new Date() : null;
      await storage.updateIntelligenceBriefing(opts.briefingId, {
        hubspotPushedAt: pushedAt,
        hubspotPushResult: { pushed, skipped, tasksPushed, at: new Date().toISOString() },
      });
    } catch (persistErr: any) {
      console.warn(`[HubSpot] persisting briefing push result failed:`, persistErr?.message || persistErr);
    }

    return { pushed, skipped, tasksPushed };
  } catch (err: any) {
    console.warn(`[HubSpot] autoPushBriefing failed for tenant=${opts.tenantDomain}:`, err?.message || err);
    try {
      await storage.updateIntelligenceBriefing(opts.briefingId, {
        hubspotPushResult: { pushed: 0, skipped: 0, tasksPushed: 0, reason: "error", error: err?.message || String(err), at: new Date().toISOString() },
      });
    } catch {
      /* ignore — briefing may not exist or update may race */
    }
    return { pushed: 0, skipped: 0, tasksPushed: 0, reason: "error" };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
