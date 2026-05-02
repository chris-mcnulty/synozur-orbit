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

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: user.graphRefreshToken,
    scope: PLANNER_SCOPES.join(" "),
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
        } as any);
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
    } as any);

    return accessToken;
  } catch (err: any) {
    console.error("[Planner] Token refresh exception:", err.message);
    return null;
  }
}

async function graphRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
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
  if (res.status === 204) return undefined as any;
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
  },
): Promise<PlannerTask> {
  const body: any = {
    planId: opts.planId,
    title: opts.title,
  };
  if (opts.bucketId) body.bucketId = opts.bucketId;
  if (opts.priority !== undefined) body.priority = opts.priority;
  if (opts.dueDateTime) body.dueDateTime = opts.dueDateTime;
  if (opts.percentComplete !== undefined) body.percentComplete = opts.percentComplete;

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
}): string | null {
  const clientId = process.env.ENTRA_CLIENT_ID;
  if (!clientId) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: opts.redirectUri,
    response_mode: "query",
    scope: PLANNER_SCOPES.join(" "),
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
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    scope: PLANNER_SCOPES.join(" "),
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
    } as any);
    return true;
  } catch (err: any) {
    console.error("[Planner] Code exchange exception:", err.message);
    return false;
  }
}

export { GraphHttpError };
