/**
 * LinkedIn MCP client — lightweight JSON-RPC over streamable HTTP.
 *
 * Talks to the mcpbundles LinkedIn MCP server via Bearer-authenticated
 * POST requests. Maintains a session ID across calls for stateful tool use.
 * Discovers available tools on first use and caches the list for the
 * lifetime of the process.
 */

const getMcpUrl = () => process.env.LINKEDIN_MCP_URL?.trim() ?? "";
const getMcpKey = () => process.env.LINKEDIN_MCP_API_KEY?.trim() ?? "";

let sessionId: string | null = null;
let initialized = false;
let cachedTools: McpTool[] = [];
let requestId = 1;

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpTextContent {
  type: "text";
  text: string;
}

export interface McpCallResult {
  content: McpTextContent[];
  isError?: boolean;
}

class McpError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
    this.name = "McpError";
  }
}

async function mcpPost(method: string, params: unknown = {}): Promise<unknown> {
  const url = getMcpUrl();
  const key = getMcpKey();
  if (!url || !key) throw new McpError("LinkedIn MCP not configured — LINKEDIN_MCP_URL and LINKEDIN_MCP_API_KEY must be set.");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "Authorization": `Bearer ${key}`,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const body = JSON.stringify({ jsonrpc: "2.0", id: requestId++, method, params });
  const resp = await fetch(url, { method: "POST", headers, body });

  const newSession = resp.headers.get("mcp-session-id");
  if (newSession) sessionId = newSession;

  const text = await resp.text();
  if (!resp.ok && !text) {
    throw new McpError(`LinkedIn MCP HTTP ${resp.status}`, resp.status);
  }

  // Handle SSE envelope ("data: {...}\n\n")
  if (text.trimStart().startsWith("data:")) {
    const lines = text.split("\n").filter((l) => l.startsWith("data:"));
    for (const line of lines) {
      try {
        const msg = JSON.parse(line.slice(5).trim()) as { result?: unknown; error?: { message?: string; code?: number } };
        if (msg.error) throw new McpError(msg.error.message ?? "MCP error", msg.error.code);
        if ("result" in msg) return msg.result;
      } catch (e) {
        if (e instanceof McpError) throw e;
      }
    }
    return null;
  }

  let json: { result?: unknown; error?: { message?: string; code?: number } };
  try {
    json = JSON.parse(text);
  } catch {
    throw new McpError(`LinkedIn MCP returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (json.error) throw new McpError(json.error.message ?? "MCP error", json.error.code);
  return json.result;
}

async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  await mcpPost("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "orbit", version: "1.0" },
  });
  // Fire-and-forget initialized notification — ignore errors.
  mcpPost("notifications/initialized", {}).catch(() => {});
  initialized = true;
}

/** List all tools the LinkedIn MCP server exposes (cached per process). */
export async function listLinkedInTools(): Promise<McpTool[]> {
  if (cachedTools.length > 0) return cachedTools;
  await ensureInitialized();
  const result = (await mcpPost("tools/list", {})) as { tools?: McpTool[] } | null;
  cachedTools = result?.tools ?? [];
  return cachedTools;
}

/** Call a named MCP tool with the given arguments. */
export async function callLinkedInTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
  await ensureInitialized();
  const result = (await mcpPost("tools/call", { name, arguments: args })) as McpCallResult | null;
  if (!result) throw new McpError(`Tool "${name}" returned no result.`);
  if (result.isError) {
    const msg = result.content?.find((c) => c.type === "text")?.text ?? "Unknown MCP tool error";
    throw new McpError(msg);
  }
  return result;
}

/**
 * Find the first tool whose name includes any of the given substrings
 * (case-insensitive). Useful for normalising across MCP server versions.
 */
export async function findTool(...nameSubstrings: string[]): Promise<string | null> {
  const tools = await listLinkedInTools();
  for (const sub of nameSubstrings) {
    const match = tools.find((t) => t.name.toLowerCase().includes(sub.toLowerCase()));
    if (match) return match.name;
  }
  return null;
}

/** Returns plain text from the first text content block in a tool result. */
export function extractText(result: McpCallResult): string {
  return result.content?.find((c) => c.type === "text")?.text ?? "";
}
