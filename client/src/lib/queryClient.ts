import { QueryClient, QueryFunction } from "@tanstack/react-query";

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
    throw new ApiError(res.status, errorMessage, upgradeRequired, requiredPlan);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
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
