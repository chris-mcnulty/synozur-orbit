import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getTabContextHeaders, clearTabContext } from "./tabContext";

/**
 * If a request returns 403 because the per-tab tenant/market headers reference
 * something the user can't access (e.g. the market was deleted in another tab,
 * or sessionStorage was tampered with), clear the per-tab context so the next
 * request falls back to the session default and the app re-bootstraps. Without
 * this, a stale tab context can strand a user in a 403 loop.
 */
function maybeRecoverFromStaleTabContext(status: number, message: string) {
  if (status !== 403) return;
  const m = (message || "").toLowerCase();
  const isStaleContext =
    m.includes("requested tenant not found") ||
    m.includes("requested market does not belong") ||
    m.includes("access denied for requested tenant");
  if (!isStaleContext) return;
  clearTabContext();
  // Force the next render cycle to re-fetch fresh /api/context and /api/markets.
  setTimeout(() => {
    queryClient.invalidateQueries();
  }, 0);
}

export class ApiError extends Error {
  status: number;
  upgradeRequired?: boolean;
  requiredPlan?: string;

  constructor(status: number, message: string, upgradeRequired?: boolean, requiredPlan?: string) {
    super(`${status}: ${message}`);
    this.status = status;
    this.upgradeRequired = upgradeRequired;
    this.requiredPlan = requiredPlan;
  }
}

async function safeJsonParse(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (text.includes("<!DOCTYPE") || text.includes("<html") || text.includes("<HTML")) {
      throw new Error("Server temporarily unavailable. Please try again in a moment.");
    }
    throw new Error(`Invalid response from server: ${text.substring(0, 100)}`);
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let errorMessage = res.statusText;
    let upgradeRequired = false;
    let requiredPlan: string | undefined;
    try {
      const text = await res.text();
      if (text.includes("<!DOCTYPE") || text.includes("<html") || text.includes("<HTML")) {
        errorMessage = "Server temporarily unavailable. Please try again in a moment.";
      } else {
        try {
          const json = JSON.parse(text);
          errorMessage = json.error || json.message || text;
          if (json.upgradeRequired) {
            upgradeRequired = true;
            requiredPlan = json.requiredPlan;
          }
        } catch {
          errorMessage = text || res.statusText;
        }
      }
    } catch {}
    maybeRecoverFromStaleTabContext(res.status, errorMessage);
    throw new ApiError(res.status, errorMessage, upgradeRequired, requiredPlan);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = { ...getTabContextHeaders() };
  if (data) headers["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      headers: getTabContextHeaders(),
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await safeJsonParse(res);
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
