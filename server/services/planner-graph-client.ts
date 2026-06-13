/**
 * Microsoft Graph client for Planner operations.
 *
 * Uses delegated tokens captured via the Entra OAuth flow with
 * `Tasks.ReadWrite Group.Read.All offline_access` scopes. Tokens are stored on
 * the user record and refreshed on demand (see `getValidGraphToken`).
 *
 * Reference: https://learn.microsoft.com/en-us/graph/api/resources/planner-overview
 */

import { storage } from "../storage";
import type { User } from "@shared/schema";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export const PLANNER_SCOPES = [
  "Tasks.ReadWrite",
  "Group.Read.All",
  "User.Read",
  "offline_access",
];

// Delegated mailbox scopes for the sales-outreach Outlook-draft flow. Granted
// per-seller via incremental consent; the union with any already-granted scopes
// is requested so connecting the mailbox never drops Planner access.
export const MAIL_SCOPES = [
  "Mail.ReadWrite",
  "User.Read",
  "offline_access",
];

export interface PlannerGroup {
  id: string;
  displayName: string;
  description?: string | null;
}

export interface PlannerPlan {
  id: string;
  title: string;
  owner?: string;
}

export interface PlannerBucket {
  id: string;
  name: string;
  planId: string;
  orderHint?: string;
}

export interface PlannerTask {
  id: string;
  title: string;
  planId: string;
  bucketId: string | null;
  percentComplete: number;
  priority: number; // 0 (low) - 10 (urgent), Planner uses 1, 3, 5, 9
  dueDateTime?: string | null;
  etag?: string | null;
  /** Server-side last modification timestamp from Microsoft Graph. */
  lastModifiedDateTime?: string | null;
  /** Map of Entra/AAD user oid → assignment metadata. */
  assignments?: Record<string, { orderHint?: string }>;
}

/**
 * Build a Planner `assignments` payload from a list of Entra (AAD) oids.
 * Microsoft expects `null` to remove an assignment and a `plannerAssignment`
 * object to add one.
 */
export function buildAssignmentsPayload(
  desiredOids: string[],
  currentOids: string[],
): Record<string, any> | null {
  const desired = Array.from(new Set(desiredOids.filter(Boolean)));
  const current = Array.from(new Set(currentOids.filter(Boolean)));
  const payload: Record<string, any> = {};
  for (const oid of desired) {
    if (!current.includes(oid)) {
      payload[oid] = { "@odata.type": "#microsoft.graph.plannerAssignment", orderHint: " !" };
    }
  }
  for (const oid of current) {
    if (!desired.includes(oid)) {
      payload[oid] = null;
    }
  }
  return Object.keys(payload).length === 0 ? null : payload;
}

class GraphHttpError extends Error {
  status: number;
  body: any;
  constructor(message: string, status: number, body: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/**
 * Acquire a fresh Graph token for the user, refreshing the stored token if it
 * has expired. Returns null if the user has not granted Planner consent or the
 * refresh failed (caller should prompt re-consent).
 */
export async function getValidGraphToken(userId: string): Promise<string | null> {
  const user = await storage.getUser(userId);
  if (!user || !user.graphRefreshToken) return null;

  const now = Date.now();
  const expiresAt = user.graphTokenExpiresAt ? new Date(user.graphTokenExpiresAt).getTime() : 0;

  // 60s safety window
  if (user.graphAccessToken && expiresAt > now + 60_000) {
    return user.graphAccessToken;
  }

  const refreshed = await refreshGraphToken(user);
  return refreshed;
}

async function refreshGraphToken(user: User): Promise<string | null> {
  const clientId = process.env.ENTRA_CLIENT_ID;
  const clientSecret = process.env.ENTRA_CLIENT_SECRET;
  if (!clientId || !clientSecret || !user.graphRefreshToken) return null;

  // Use "common" so users from any tenant can refresh their own token
  const tenant = process.env.ENTRA_TENANT_ID || "common";
  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

  // Refresh with exactly the scopes this user actually granted (Planner, Mail,
  // or both) — never a hardcoded set — so a Planner-only or Mail-only consent
  // refreshes cleanly without requesting an unconsented scope.
  const grantedScopes = (user.graphScopes || "")
    .split(/\s+/)
    .filter((s) => s && !s.startsWith("openid") && s !== "profile" && s !== "email");
  const refreshScopes = grantedScopes.length > 0 ? grantedScopes : PLANNER_SCOPES;

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: user.graphRefreshToken,
    scope: refreshScopes.join(" "),
  });

  try {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.error("[Planner] Token refresh failed:", res.status, errBody);
      // If refresh token is invalid, clear stored tokens to force re-consent
      if (res.status === 400 || res.status === 401) {
        await storage.updateUser(user.id, {
          graphAccessToken: null,
          graphRefreshToken: null,
          graphTokenExpiresAt: null,
        });
      }
      return null;
    }
    const data = await res.json();
    const accessToken: string = data.access_token;
    const refreshToken: string = data.refresh_token || user.graphRefreshToken;
    const expiresIn: number = data.expires_in || 3600;
    const scope: string = data.scope || "";

    await storage.updateUser(user.id, {
      graphAccessToken: accessToken,
      graphRefreshToken: refreshToken,
      graphTokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
      graphScopes: scope,
    });

    return accessToken;
  } catch (err: any) {
    console.error("[Planner] Token refresh exception:", err.message);
    return null;
  }
}

async function graphRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  // Guard against path injection — all Graph paths must be relative
  if (!path.startsWith("/")) {
    throw new Error(`[Planner] Invalid Graph path — must start with '/': ${path}`);
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) || {}),
  };
  const res = await fetch(`${GRAPH_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new GraphHttpError(
      `Graph ${init.method || "GET"} ${path} failed: ${res.status}`,
      res.status,
      body,
    );
  }
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

// ---------- High-level API ----------

export async function listUserGroups(token: string): Promise<PlannerGroup[]> {
  // Microsoft 365 Groups the user is a member of. Planner plans live on these
  // groups (or on Microsoft Teams, which are backed by groups).
  const data = await graphRequest<{ value: any[] }>(
    token,
    "/me/memberOf?$select=id,displayName,description,groupTypes&$top=100",
  );
  return (data.value || [])
    .filter((g) => Array.isArray(g.groupTypes) && g.groupTypes.includes("Unified"))
    .map((g) => ({
      id: g.id,
      displayName: g.displayName,
      description: g.description,
    }));
}

export async function listGroupPlans(token: string, groupId: string): Promise<PlannerPlan[]> {
  const data = await graphRequest<{ value: any[] }>(token, `/groups/${groupId}/planner/plans`);
  return (data.value || []).map((p) => ({
    id: p.id,
    title: p.title,
    owner: p.owner,
  }));
}

export async function listPlanBuckets(token: string, planId: string): Promise<PlannerBucket[]> {
  const data = await graphRequest<{ value: any[] }>(token, `/planner/plans/${planId}/buckets`);
  return (data.value || []).map((b) => ({
    id: b.id,
    name: b.name,
    planId: b.planId,
    orderHint: b.orderHint,
  }));
}

/**
 * List all tasks in a Planner plan. Used for the pull (Planner → Orbit)
 * direction of the two-way sync.
 */
export async function listPlanTasks(token: string, planId: string): Promise<PlannerTask[]> {
  const data = await graphRequest<{ value: any[] }>(token, `/planner/plans/${planId}/tasks`);
  return (data.value || []).map((t) => ({
    id: t.id,
    title: t.title,
    planId: t.planId,
    bucketId: t.bucketId ?? null,
    percentComplete: t.percentComplete ?? 0,
    priority: t.priority ?? 5,
    dueDateTime: t.dueDateTime ?? null,
    etag: t["@odata.etag"] ?? null,
    lastModifiedDateTime: t.lastModifiedDateTime ?? null,
    assignments: (t.assignments && typeof t.assignments === "object") ? t.assignments : {},
  }));
}

export async function createBucket(
  token: string,
  planId: string,
  name: string,
): Promise<PlannerBucket> {
  const created = await graphRequest<any>(token, `/planner/buckets`, {
    method: "POST",
    body: JSON.stringify({ name, planId, orderHint: " !" }),
  });
  return {
    id: created.id,
    name: created.name,
    planId: created.planId,
    orderHint: created.orderHint,
  };
}

/**
 * Create a Planner task in the given plan and bucket. Returns the created
 * task plus the @odata.etag needed for subsequent updates.
 */
export async function createTask(
  token: string,
  opts: {
    planId: string;
    bucketId: string | null;
    title: string;
    priority?: number; // Planner: 1=urgent, 3=important, 5=medium (default), 9=low
    dueDateTime?: string | null; // ISO 8601 UTC
    percentComplete?: number;
    assignments?: Record<string, any> | null;
  },
): Promise<PlannerTask> {
  const body: Record<string, unknown> = {
    planId: opts.planId,
    title: opts.title,
  };
  if (opts.bucketId) body.bucketId = opts.bucketId;
  if (opts.priority !== undefined) body.priority = opts.priority;
  if (opts.dueDateTime) body.dueDateTime = opts.dueDateTime;
  if (opts.percentComplete !== undefined) body.percentComplete = opts.percentComplete;
  if (opts.assignments) body.assignments = opts.assignments;

  const created = await graphRequest<any>(token, `/planner/tasks`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return {
    id: created.id,
    title: created.title,
    planId: created.planId,
    bucketId: created.bucketId,
    percentComplete: created.percentComplete,
    priority: created.priority,
    dueDateTime: created.dueDateTime,
    etag: created["@odata.etag"] || null,
    lastModifiedDateTime: created.lastModifiedDateTime ?? null,
    assignments: created.assignments && typeof created.assignments === "object" ? created.assignments : {},
  };
}

/**
 * Update a Planner task. Requires the current etag (sent as If-Match) to
 * satisfy Graph's optimistic concurrency. Returns the new etag.
 */
export async function updateTask(
  token: string,
  taskId: string,
  etag: string,
  updates: {
    title?: string;
    bucketId?: string | null;
    priority?: number;
    dueDateTime?: string | null;
    percentComplete?: number;
    assignments?: Record<string, any> | null;
  },
): Promise<string | null> {
  // PATCH returns 204 No Content; we need to GET to retrieve the new etag.
  const headers: Record<string, string> = { "If-Match": etag };
  await graphRequest<void>(token, `/planner/tasks/${taskId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(updates),
  });
  // Fetch refreshed task to get new etag
  const refreshed = await graphRequest<any>(token, `/planner/tasks/${taskId}`);
  return refreshed["@odata.etag"] || null;
}

export async function deleteTask(token: string, taskId: string, etag: string): Promise<void> {
  await graphRequest<void>(token, `/planner/tasks/${taskId}`, {
    method: "DELETE",
    headers: { "If-Match": etag },
  });
}

export async function getTask(token: string, taskId: string): Promise<PlannerTask | null> {
  try {
    const data = await graphRequest<any>(token, `/planner/tasks/${taskId}`);
    return {
      id: data.id,
      title: data.title,
      planId: data.planId,
      bucketId: data.bucketId,
      percentComplete: data.percentComplete,
      priority: data.priority,
      dueDateTime: data.dueDateTime,
      etag: data["@odata.etag"] || null,
      lastModifiedDateTime: data.lastModifiedDateTime ?? null,
      assignments: data.assignments && typeof data.assignments === "object" ? data.assignments : {},
    };
  } catch (err: any) {
    if (err instanceof GraphHttpError && err.status === 404) return null;
    throw err;
  }
}

// ---------- OAuth helpers ----------

/**
 * Build the consent URL for incremental Planner permission. We use the
 * "common" tenant so multi-tenant orgs work; the redirect URI is the existing
 * Entra callback, which routes by `state` to handle Planner consent.
 */
export function buildPlannerConsentUrl(opts: {
  state: string;
  redirectUri: string;
  /** Scopes to request. Defaults to the Planner set. */
  scopes?: string[];
}): string | null {
  const clientId = process.env.ENTRA_CLIENT_ID;
  if (!clientId) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: opts.redirectUri,
    response_mode: "query",
    scope: (opts.scopes ?? PLANNER_SCOPES).join(" "),
    state: opts.state,
    prompt: "consent",
  });
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
}

/**
 * Exchange an authorization code for delegated tokens and persist them on the
 * user. Returns true on success.
 */
export async function exchangeCodeForGraphTokens(opts: {
  userId: string;
  code: string;
  redirectUri: string;
}): Promise<boolean> {
  const clientId = process.env.ENTRA_CLIENT_ID;
  const clientSecret = process.env.ENTRA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return false;

  const tokenUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/token`;
  // No `scope` on the auth-code exchange: the code already carries the consented
  // scopes, and the response returns them. This keeps the exchange flow-agnostic
  // so the same callback serves both Planner and mailbox (Mail.ReadWrite) consent.
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
  });

  try {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.error("[Planner] Code exchange failed:", res.status, errBody);
      return false;
    }
    const data = await res.json();
    await storage.updateUser(opts.userId, {
      graphAccessToken: data.access_token,
      graphRefreshToken: data.refresh_token,
      graphTokenExpiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000),
      graphScopes: data.scope || "",
    });
    return true;
  } catch (err: any) {
    console.error("[Planner] Code exchange exception:", err.message);
    return false;
  }
}

// ---------- Change-notification subscriptions (Planner → Orbit webhook) ----------

export interface GraphSubscription {
  id: string;
  resource: string;
  changeType: string;
  notificationUrl: string;
  expirationDateTime: string;
  clientState?: string;
}

/**
 * Create a Microsoft Graph change-notification subscription on a Planner plan.
 * Graph subscriptions on Planner resources currently support a maximum
 * lifetime of ~3 days (4230 minutes) so callers must renew periodically.
 *
 * @param token            User delegated token
 * @param resource         Graph resource path, e.g. `/planner/plans/{id}/tasks`
 * @param notificationUrl  Public webhook URL (HTTPS) reachable from Microsoft
 * @param clientState      Opaque secret echoed back in every notification
 * @param expiresAt        Optional expiration; defaults to ~70 hours
 */
export async function createGraphSubscription(
  token: string,
  opts: {
    resource: string;
    notificationUrl: string;
    clientState: string;
    expiresAt?: Date;
    changeType?: string;
  },
): Promise<GraphSubscription> {
  const expiration = opts.expiresAt ?? new Date(Date.now() + 70 * 60 * 60 * 1000);
  const created = await graphRequest<any>(token, `/subscriptions`, {
    method: "POST",
    body: JSON.stringify({
      changeType: opts.changeType || "updated,deleted",
      notificationUrl: opts.notificationUrl,
      resource: opts.resource,
      expirationDateTime: expiration.toISOString(),
      clientState: opts.clientState,
    }),
  });
  return {
    id: created.id,
    resource: created.resource,
    changeType: created.changeType,
    notificationUrl: created.notificationUrl,
    expirationDateTime: created.expirationDateTime,
    clientState: created.clientState,
  };
}

export async function renewGraphSubscription(
  token: string,
  subscriptionId: string,
  expiresAt?: Date,
): Promise<GraphSubscription> {
  const expiration = expiresAt ?? new Date(Date.now() + 70 * 60 * 60 * 1000);
  const updated = await graphRequest<any>(token, `/subscriptions/${subscriptionId}`, {
    method: "PATCH",
    body: JSON.stringify({ expirationDateTime: expiration.toISOString() }),
  });
  return {
    id: updated.id,
    resource: updated.resource,
    changeType: updated.changeType,
    notificationUrl: updated.notificationUrl,
    expirationDateTime: updated.expirationDateTime,
    clientState: updated.clientState,
  };
}

export async function deleteGraphSubscription(
  token: string,
  subscriptionId: string,
): Promise<void> {
  try {
    await graphRequest<void>(token, `/subscriptions/${subscriptionId}`, { method: "DELETE" });
  } catch (err: any) {
    // 404s during teardown are fine
    if (err instanceof GraphHttpError && err.status === 404) return;
    throw err;
  }
}

export { GraphHttpError };
