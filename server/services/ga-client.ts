/**
 * Google Analytics 4 OAuth + Data API client.
 *
 * Uses google-auth-library for OAuth2 token exchange and direct REST calls
 * against the Analytics Admin + Data APIs. When OAuth credentials are not
 * configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing), helpers
 * gracefully no-op so the rest of the outcomes pipeline can still run with
 * UTM-only data.
 */

import { db } from "../db";
import { analyticsConnections, analyticsDaily, marketingLinkClicks, marketingLinks } from "@shared/schema";
import { encryptSecret, decryptSecret, tryDecryptSecret } from "../utils/encryption";
import { eq, and, sql, isNull } from "drizzle-orm";

const GA_SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
];

export function isGaConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function getGaRedirectUri(): string {
  const base = process.env.PUBLIC_APP_URL || `http://localhost:${process.env.PORT || 5000}`;
  return `${base.replace(/\/$/, "")}/api/insights/ga/callback`;
}

export function buildGaAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: getGaRedirectUri(),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: GA_SCOPES.join(" "),
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope?: string;
}> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: getGaRedirectUri(),
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GA token exchange failed: ${res.status} ${text}`);
  }
  const data: any = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in || 3600,
    scope: data.scope,
  };
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GA token refresh failed: ${res.status} ${text}`);
  }
  const data: any = await res.json();
  return { accessToken: data.access_token, expiresIn: data.expires_in || 3600 };
}

async function getValidAccessToken(connectionId: string): Promise<string | null> {
  const [conn] = await db.select().from(analyticsConnections).where(eq(analyticsConnections.id, connectionId));
  if (!conn) return null;
  const expiresAt = conn.tokenExpiresAt ? new Date(conn.tokenExpiresAt).getTime() : 0;
  if (expiresAt > Date.now() + 60_000 && conn.accessTokenEnc) {
    const tok = tryDecryptSecret(conn.accessTokenEnc);
    if (tok) return tok;
  }
  if (!conn.refreshTokenEnc) return null;
  const refresh = tryDecryptSecret(conn.refreshTokenEnc);
  if (!refresh) return null;
  const fresh = await refreshAccessToken(refresh);
  await db.update(analyticsConnections)
    .set({
      accessTokenEnc: encryptSecret(fresh.accessToken),
      tokenExpiresAt: new Date(Date.now() + fresh.expiresIn * 1000),
      updatedAt: new Date(),
    })
    .where(eq(analyticsConnections.id, connectionId));
  return fresh.accessToken;
}

export async function listGaProperties(connectionId: string): Promise<Array<{ id: string; displayName: string; account: string }>> {
  const token = await getValidAccessToken(connectionId);
  if (!token) return [];
  const accountsRes = await fetch("https://analyticsadmin.googleapis.com/v1beta/accountSummaries", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!accountsRes.ok) {
    throw new Error(`GA accountSummaries failed: ${accountsRes.status}`);
  }
  const data: any = await accountsRes.json();
  const out: Array<{ id: string; displayName: string; account: string }> = [];
  for (const acct of data.accountSummaries || []) {
    for (const p of acct.propertySummaries || []) {
      out.push({ id: p.property, displayName: p.displayName, account: acct.displayName });
    }
  }
  return out;
}

interface GaDailyRow {
  date: string;
  source: string;
  medium: string;
  campaign: string | null;
  sessions: number;
  users: number;
  conversions: number;
  revenue: number; // cents
}

export async function fetchGaDaily(
  connectionId: string,
  propertyId: string,
  startDate: string,
  endDate: string,
): Promise<GaDailyRow[]> {
  const token = await getValidAccessToken(connectionId);
  if (!token) return [];
  const body = {
    dateRanges: [{ startDate, endDate }],
    dimensions: [
      { name: "date" },
      { name: "sessionSourceMediumLastNonDirect" },
      { name: "sessionCampaignName" },
    ],
    metrics: [
      { name: "sessions" },
      { name: "totalUsers" },
      { name: "conversions" },
      { name: "totalRevenue" },
    ],
    limit: "10000",
  };
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GA runReport failed: ${res.status} ${text}`);
  }
  const data: any = await res.json();
  const rows: GaDailyRow[] = [];
  for (const r of data.rows || []) {
    const dateRaw = r.dimensionValues?.[0]?.value || "";
    const sourceMedium = r.dimensionValues?.[1]?.value || "(direct) / (none)";
    const campaign = r.dimensionValues?.[2]?.value || null;
    const [src, med] = sourceMedium.split(" / ").map((s: string) => s.trim());
    rows.push({
      date: `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`,
      source: src || "(direct)",
      medium: med || "(none)",
      campaign,
      sessions: Number(r.metricValues?.[0]?.value || 0),
      users: Number(r.metricValues?.[1]?.value || 0),
      conversions: Number(r.metricValues?.[2]?.value || 0),
      revenue: Math.round(Number(r.metricValues?.[3]?.value || 0) * 100),
    });
  }
  return rows;
}

/**
 * Pull yesterday's analytics for every connected tenant/market and persist
 * into analytics_daily. Joins UTM clicks from marketing_links so SoV/funnel
 * computations have a unified row per (tenant, market, date, source, medium,
 * campaign).
 */
export async function runDailyAnalyticsPull(opts?: { tenantDomain?: string; marketId?: string | null; startDate?: string; endDate?: string }): Promise<{ pulled: number; errors: number }> {
  let pulled = 0;
  let errors = 0;

  const baseWhere = [eq(analyticsConnections.status, "connected")];
  if (opts?.tenantDomain) baseWhere.push(eq(analyticsConnections.tenantDomain, opts.tenantDomain));
  if (opts?.marketId !== undefined) {
    baseWhere.push(opts.marketId === null ? isNull(analyticsConnections.marketId) : eq(analyticsConnections.marketId, opts.marketId));
  }
  const conns = await db.select().from(analyticsConnections).where(and(...baseWhere));

  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const startDate = opts?.startDate || yesterday.toISOString().slice(0, 10);
  const endDate = opts?.endDate || yesterday.toISOString().slice(0, 10);

  for (const conn of conns) {
    if (!conn.propertyId) continue;
    try {
      const rows = isGaConfigured()
        ? await fetchGaDaily(conn.id, conn.propertyId, startDate, endDate)
        : [];

      // Compute Orbit-attributed clicks for the same window from
      // marketing_link_clicks joined to marketing_links (tenant + market
      // scoped so a multi-market tenant doesn't cross-contaminate).
      const clickRows = await db
        .select({
          source: marketingLinks.utmSource,
          medium: marketingLinks.utmMedium,
          campaign: marketingLinks.utmCampaign,
          clicks: sql<number>`count(*)::int`,
        })
        .from(marketingLinkClicks)
        .innerJoin(marketingLinks, eq(marketingLinkClicks.linkId, marketingLinks.id))
        .where(and(
          eq(marketingLinks.tenantDomain, conn.tenantDomain),
          conn.marketId
            ? eq(marketingLinks.marketId, conn.marketId)
            : isNull(marketingLinks.marketId),
          eq(marketingLinkClicks.isBot, false),
          sql`date_trunc('day', ${marketingLinkClicks.clickedAt}) = ${startDate}::date`,
        ))
        .groupBy(marketingLinks.utmSource, marketingLinks.utmMedium, marketingLinks.utmCampaign);

      const clickMap = new Map<string, number>();
      for (const c of clickRows) {
        const key = `${c.source || "(direct)"}|${c.medium || "(none)"}|${c.campaign || ""}`;
        clickMap.set(key, c.clicks);
      }

      // Wipe + insert for the window (idempotent re-pull). Scoped by
      // tenant + market so each (tenant, market) connection refreshes only
      // its own rows.
      await db.delete(analyticsDaily).where(and(
        eq(analyticsDaily.tenantDomain, conn.tenantDomain),
        conn.marketId
          ? eq(analyticsDaily.marketId, conn.marketId)
          : isNull(analyticsDaily.marketId),
        eq(analyticsDaily.date, startDate),
      ));

      const inserts = rows.map((r) => {
        const key = `${r.source}|${r.medium}|${r.campaign || ""}`;
        const orbitClicks = clickMap.get(key) || 0;
        clickMap.delete(key);
        return {
          tenantDomain: conn.tenantDomain,
          marketId: conn.marketId,
          date: r.date,
          source: r.source,
          medium: r.medium,
          campaign: r.campaign,
          sessions: r.sessions,
          users: r.users,
          conversions: r.conversions,
          revenue: r.revenue,
          orbitClicks,
        };
      });

      // Any leftover UTM clicks that GA didn't report (or no GA at all)
      for (const [key, clicks] of Array.from(clickMap.entries())) {
        const [source, medium, campaign] = key.split("|");
        inserts.push({
          tenantDomain: conn.tenantDomain,
          marketId: conn.marketId,
          date: startDate,
          source: source || "(direct)",
          medium: medium || "(none)",
          campaign: campaign || null,
          sessions: 0,
          users: 0,
          conversions: 0,
          revenue: 0,
          orbitClicks: clicks,
        });
      }

      if (inserts.length > 0) {
        await db.insert(analyticsDaily).values(inserts);
      }

      await db.update(analyticsConnections)
        .set({ lastSyncAt: new Date(), lastError: null, status: "connected" })
        .where(eq(analyticsConnections.id, conn.id));
      pulled++;
    } catch (err: any) {
      errors++;
      await db.update(analyticsConnections)
        .set({ lastError: err?.message || String(err), status: "error", updatedAt: new Date() })
        .where(eq(analyticsConnections.id, conn.id));
      console.error("[GA Daily Pull] error for connection", conn.id, err);
    }
  }

  // Tenants without GA connections — still aggregate UTM clicks so outcomes
  // dashboard works for marketing-link-only customers.
  await aggregateUtmOnlyClicks(startDate);

  return { pulled, errors };
}

async function aggregateUtmOnlyClicks(date: string): Promise<void> {
  const grouped = await db
    .select({
      tenantDomain: marketingLinks.tenantDomain,
      marketId: marketingLinks.marketId,
      source: marketingLinks.utmSource,
      medium: marketingLinks.utmMedium,
      campaign: marketingLinks.utmCampaign,
      clicks: sql<number>`count(*)::int`,
    })
    .from(marketingLinkClicks)
    .innerJoin(marketingLinks, eq(marketingLinkClicks.linkId, marketingLinks.id))
    .where(and(
      eq(marketingLinkClicks.isBot, false),
      sql`date_trunc('day', ${marketingLinkClicks.clickedAt}) = ${date}::date`,
    ))
    .groupBy(marketingLinks.tenantDomain, marketingLinks.marketId, marketingLinks.utmSource, marketingLinks.utmMedium, marketingLinks.utmCampaign);

  // (tenant, market) pairs that already had GA-pulled rows for this day —
  // skip those exact pairs so we don't double-count, but keep aggregating
  // UTM clicks for any (tenant, market) that doesn't have a GA connection.
  const gaPairs = new Set(
    (await db.select({ tenantDomain: analyticsDaily.tenantDomain, marketId: analyticsDaily.marketId })
      .from(analyticsDaily)
      .where(eq(analyticsDaily.date, date))
    ).map((r) => `${r.tenantDomain}|${r.marketId || ""}`),
  );

  for (const row of grouped) {
    const key = `${row.tenantDomain}|${row.marketId || ""}`;
    if (gaPairs.has(key)) continue;
    await db.insert(analyticsDaily).values({
      tenantDomain: row.tenantDomain,
      marketId: row.marketId,
      date,
      source: row.source || "(direct)",
      medium: row.medium || "(none)",
      campaign: row.campaign || null,
      sessions: 0,
      users: 0,
      conversions: 0,
      revenue: 0,
      orbitClicks: row.clicks,
    });
  }
}
