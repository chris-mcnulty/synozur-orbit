const TENANT_KEY = "orbit.activeTenantId";
const MARKET_KEY = "orbit.activeMarketId";

function safeGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
  }
}

export function getTabTenantId(): string | null {
  return safeGet(TENANT_KEY);
}

export function getTabMarketId(): string | null {
  return safeGet(MARKET_KEY);
}

export function setTabTenantId(id: string | null) {
  safeSet(TENANT_KEY, id);
}

export function setTabMarketId(id: string | null) {
  safeSet(MARKET_KEY, id);
}

export function getTabContextHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const t = getTabTenantId();
  const m = getTabMarketId();
  if (t) headers["X-Active-Tenant-Id"] = t;
  if (m) headers["X-Active-Market-Id"] = m;
  return headers;
}

export function clearTabContext() {
  safeSet(TENANT_KEY, null);
  safeSet(MARKET_KEY, null);
}

let fetchPatched = false;

/**
 * Monkey-patches window.fetch to inject per-tab context headers
 * (X-Active-Tenant-Id, X-Active-Market-Id) on every same-origin /api request.
 * This guarantees that ALL fetch callers — not just our apiRequest helper —
 * carry this tab's active tenant/market, so the server never falls back to the
 * shared session value when we have a per-tab choice. Without this, opening
 * the app in two tabs would let one tab's market context leak into the other.
 */
export function installTabContextFetchInterceptor() {
  if (fetchPatched || typeof window === "undefined") return;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let url = "";
    if (typeof input === "string") url = input;
    else if (input instanceof URL) url = input.toString();
    else if (input instanceof Request) url = input.url;

    const isApi = url.startsWith("/api/") || url.startsWith("/api?") ||
      (typeof window !== "undefined" && url.startsWith(window.location.origin + "/api"));

    if (!isApi) return originalFetch(input as any, init);

    const ctxHeaders = getTabContextHeaders();
    if (Object.keys(ctxHeaders).length === 0) return originalFetch(input as any, init);

    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    for (const [k, v] of Object.entries(ctxHeaders)) {
      if (!headers.has(k)) headers.set(k, v);
    }
    return originalFetch(input as any, { ...init, headers });
  };
  fetchPatched = true;
}

