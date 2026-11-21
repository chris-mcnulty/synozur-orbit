export type OrbitSseMessage =
  | { type: "start"; turnId: string }
  | { type: "status"; message: string }
  | { type: "delta"; text: string }
  | { type: "done"; turn: OrbitTurn; usage: OrbitUsage }
  | { type: "error"; message: string; turnId?: string };

export type OrbitUsage = {
  limit: number;
  used: number;
  remaining: number;
  month: string;
};

export type OrbitCitation = {
  sourceId: string;
  title: string;
  url: string;
  date: string | null;
  stale: boolean;
  quote: string;
};

export type OrbitTurn = {
  id: string;
  question: string;
  status: "processing" | "completed" | "failed" | "cancelled";
  answer: null | {
    text: string;
    citations: OrbitCitation[];
    limitations: string[];
  };
  error: string | null;
};

export type OrbitConversation = {
  id: string;
  title: string;
  turns: OrbitTurn[];
};

export type OrbitConversationSummary = {
  id: string;
  title: string;
  updatedAt: string;
};

export type OrbitWorkspace = {
  context: { userId: string; tenantId: string; marketId: string | null };
  usage: OrbitUsage;
  conversations: OrbitConversationSummary[];
};

/** Parse complete SSE frames while retaining any partial frame for the next chunk. */
export function consumeOrbitSse(
  input: string,
): { messages: OrbitSseMessage[]; remainder: string } {
  const frames = input.split(/\r?\n\r?\n/);
  const remainder = frames.pop() ?? "";
  const messages: OrbitSseMessage[] = [];

  for (const frame of frames) {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      const message = JSON.parse(data) as OrbitSseMessage;
      if (message && typeof message.type === "string") messages.push(message);
    } catch {
      // Ignore malformed individual frames; a later complete frame can still be used.
    }
  }
  return { messages, remainder };
}

export function orbitContextKey(userId: string | null, tenantId: string | null, marketId: string | null) {
  return JSON.stringify([userId, tenantId, marketId]);
}

/** Evidence links are deliberately restricted to same-app paths supplied by the API. */
export function safeCitationPath(url: string): string | null {
  if (!url.startsWith("/app/") || url.startsWith("//") || url.includes("\\")) return null;
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith("/app/")) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function mergeOrbitTurn(turns: OrbitTurn[], incoming: OrbitTurn): OrbitTurn[] {
  const index = turns.findIndex((turn) => turn.id === incoming.id);
  if (index < 0) return [...turns, incoming];
  return turns.map((turn, i) => (i === index ? incoming : turn));
}
