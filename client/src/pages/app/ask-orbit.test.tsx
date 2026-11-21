// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AskOrbitPage from "./ask-orbit";
import {
  consumeOrbitSse,
  mergeOrbitTurn,
  safeCitationPath,
  type OrbitConversation,
  type OrbitTurn,
  type OrbitWorkspace,
} from "./ask-orbit-helpers";

const testContext = vi.hoisted(() => ({
  tenant: "tenant-original",
  market: "market-original",
}));

vi.mock("@/components/layout/AppLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/userContext", () => ({
  useUser: () => ({ user: { id: "user-7" } }),
}));
vi.mock("@/lib/tabContext", () => ({
  getTabTenantId: () => testContext.tenant,
  getTabMarketId: () => testContext.market,
  getTabContextHeaders: () => ({
    "X-Active-Tenant-Id": testContext.tenant,
    "X-Active-Market-Id": testContext.market,
  }),
}));

const usage = { limit: 6, used: 2, remaining: 4, month: "2025-03" };

function workspace(conversations: OrbitWorkspace["conversations"] = [], remaining = 4): OrbitWorkspace {
  return {
    context: { userId: "user-7", tenantId: testContext.tenant, marketId: testContext.market },
    usage: { ...usage, remaining, used: usage.limit - remaining },
    conversations,
  };
}

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Request failed",
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
    body: null,
  } as unknown as Response;
}

function sseResponse(messages: unknown[]) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const message of messages) controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
      controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

function failedTurn(overrides: Partial<OrbitTurn> = {}): OrbitTurn {
  return {
    id: "failed-turn",
    question: "What changed in the market?",
    status: "failed",
    answer: null,
    error: "No verified answer was returned.",
    ...overrides,
  };
}

function conversation(id: string, title: string, turns: OrbitTurn[] = []): OrbitConversation {
  return { id, title, turns };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  testContext.tenant = "tenant-original";
  testContext.market = "market-original";
});

describe("Ask Orbit focused helpers", () => {
  it("parses SSE frames split across arbitrary chunks and retains the partial frame", () => {
    const first = consumeOrbitSse('data: {"type":"start","turnId":"t-1"}\r\n\r\ndata: {"type":"del');
    expect(first.messages).toEqual([{ type: "start", turnId: "t-1" }]);
    expect(first.remainder).toBe('data: {"type":"del');

    const second = consumeOrbitSse(`${first.remainder}ta","text":"found"}\r\n\r\n`);
    expect(second.messages).toEqual([{ type: "delta", text: "found" }]);
    expect(second.remainder).toBe("");
  });

  it("only accepts same-app citation paths", () => {
    expect(safeCitationPath("/app/documents/source-4?tab=details")).toBe("/app/documents/source-4?tab=details");
    expect(safeCitationPath("https://example.com/app/document")).toBeNull();
    expect(safeCitationPath("//example.com/app/document")).toBeNull();
    expect(safeCitationPath("/app/../api/session")).toBeNull();
    expect(safeCitationPath("/app\\..\\api")).toBeNull();
    expect(safeCitationPath("/settings")).toBeNull();
  });

  it("merges a replayed turn by ID instead of adding a duplicate", () => {
    const original = failedTurn();
    const updated = { ...original, status: "completed" as const, error: null };
    const merged = mergeOrbitTurn([original], updated);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(updated);
  });
});

describe("Ask Orbit request and context safety", () => {
  it("ignores the late result from an earlier conversation selection", async () => {
    const delayedA = deferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/ask-orbit") {
        return jsonResponse(workspace([
          { id: "a", title: "Conversation A", updatedAt: new Date().toISOString() },
          { id: "b", title: "Conversation B", updatedAt: new Date().toISOString() },
        ]));
      }
      if (url.endsWith("/conversations/a")) return delayedA.promise;
      if (url.endsWith("/conversations/b")) return jsonResponse(conversation("b", "Conversation B", [{
        id: "turn-b", question: "Question B", status: "completed",
        answer: { text: "B result only", citations: [], limitations: [] }, error: null,
      }]));
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AskOrbitPage />);
    await screen.findByText("New question");

    fireEvent.click(screen.getByText("Conversation A"));
    fireEvent.click(screen.getByText("Conversation B"));
    await screen.findByText("B result only");

    await act(async () => {
      delayedA.resolve(jsonResponse(conversation("a", "Conversation A", [{
        id: "turn-a", question: "Question A", status: "completed",
        answer: { text: "Late A result", citations: [], limitations: [] }, error: null,
      }])));
    });
    expect(screen.getByText("B result only")).toBeTruthy();
    expect(screen.queryByText("Late A result")).toBeNull();
  });

  it("stops an old-context stream with its captured headers and suppresses late fetch results", async () => {
    const delayedOldConversation = deferred<Response>();
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let streamCancelled = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/ask-orbit") return jsonResponse(workspace());
      if (url === "/api/ask-orbit/conversations") return jsonResponse({ id: "stream-c", title: "Old scoped question" });
      if (url.endsWith("/conversations/stream-c/turns")) {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) { streamController = controller; },
          cancel() { streamCancelled = true; },
        }), { headers: { "Content-Type": "text/event-stream" } });
      }
      if (url.endsWith("/conversations/stream-c")) return delayedOldConversation.promise;
      if (url.endsWith("/turns/request-original/stop")) return jsonResponse({ ok: true });
      if (url === "/api/ask-orbit/conversations/stream-c/turns") {
        expect(JSON.parse(String(init?.body)).requestId).toBe("request-original");
        return jsonResponse({});
      }
      if (url === "/api/ask-orbit") return jsonResponse(workspace());
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "request-original" });
    render(<AskOrbitPage />);
    await screen.findByRole("textbox", { name: "Ask your records" });

    fireEvent.change(screen.getByRole("textbox", { name: "Ask your records" }), { target: { value: "Old scope question" } });
    fireEvent.click(screen.getByRole("button", { name: /Ask Orbit/ }));
    await screen.findByRole("button", { name: "Stop answer" });

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/conversations/stream-c"))).toBe(true));

    testContext.tenant = "tenant-new";
    testContext.market = "market-new";
    act(() => window.dispatchEvent(new Event("tab-context-changed")));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/turns/request-original/stop"))).toBe(true));

    const streamCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/conversations/stream-c/turns"));
    expect((streamCall?.[1]?.signal as AbortSignal).aborted).toBe(true);
    expect(streamCancelled).toBe(true);
    const stopCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/turns/request-original/stop"));
    expect(new Headers(stopCall?.[1]?.headers).get("X-Active-Tenant-Id")).toBe("tenant-original");
    expect(new Headers(stopCall?.[1]?.headers).get("X-Active-Market-Id")).toBe("market-original");

    await screen.findByRole("textbox", { name: "Ask your records" });
    await act(async () => {
      delayedOldConversation.resolve(jsonResponse(conversation("stream-c", "Stale old content", [{
        id: "old", question: "Old?", status: "completed",
        answer: { text: "Stale old answer", citations: [], limitations: [] }, error: null,
      }])));
    });
    expect(screen.queryByText("Stale old answer")).toBeNull();
    expect(screen.queryByText("Stale old content")).toBeNull();
    // A queued callback from the aborted reader cannot update the new-context UI.
    expect(streamController).toBeDefined();
  });

  it("uses GET-only recovery after transport loss and never posts a second request ID", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === "/api/ask-orbit") return jsonResponse(workspace());
      if (url === "/api/ask-orbit/conversations") return jsonResponse({ id: "c-transport", title: "Research question" });
      if (url.endsWith("/conversations/c-transport/turns")) throw new TypeError("Network disconnected");
      if (url.endsWith("/conversations/c-transport")) return jsonResponse(conversation("c-transport", "Research question", [{
        id: "request-stable", question: "Original question", status: "processing", answer: null, error: null,
      }]));
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "request-stable" });
    render(<AskOrbitPage />);
    await screen.findByRole("textbox", { name: "Ask your records" });
    fireEvent.change(screen.getByRole("textbox", { name: "Ask your records" }), { target: { value: "Original question" } });
    fireEvent.click(screen.getByRole("button", { name: /Ask Orbit/ }));
    await screen.findByRole("button", { name: "Check existing answer" });

    fireEvent.click(screen.getByRole("button", { name: "Check existing answer" }));
    await waitFor(() => expect(calls.filter(({ url }) => url.endsWith("/conversations/c-transport")).length).toBeGreaterThanOrEqual(2));
    const turnPosts = calls.filter(({ url, init }) => url.endsWith("/conversations/c-transport/turns") && init?.method === "POST");
    expect(turnPosts).toHaveLength(1);
    expect(JSON.parse(String(turnPosts[0].init?.body))).toEqual({
      requestId: "request-stable",
      question: "Original question",
    });
  });

  it("shows the one-answer retry cost and sends a fresh ID only for confirmed failure", async () => {
    let retryWasPosted = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/ask-orbit") return jsonResponse(workspace([
        { id: "c-failed", title: "Failed conversation", updatedAt: new Date().toISOString() },
      ], retryWasPosted ? 0 : 1));
      if (url.endsWith("/conversations/c-failed")) return jsonResponse(conversation(
        "c-failed",
        "Failed conversation",
        retryWasPosted ? [{
          id: "new-request", question: "What changed in the market?", status: "completed",
          answer: { text: "Verified answer", citations: [], limitations: [] }, error: null,
        }] : [failedTurn()],
      ));
      if (url.endsWith("/conversations/c-failed/turns") && init?.method === "POST") {
        retryWasPosted = true;
        const turn: OrbitTurn = {
          id: "new-request", question: "What changed in the market?", status: "completed",
          answer: { text: "Verified answer", citations: [], limitations: [] }, error: null,
        };
        return sseResponse([{ type: "done", turn, usage: { ...usage, used: usage.limit, remaining: 0 } }]);
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => "new-request" });
    render(<AskOrbitPage />);
    await screen.findByText("Failed conversation");
    fireEvent.click(screen.getByText("Failed conversation"));
    await screen.findByText("No verified answer was returned.");
    expect(screen.getAllByText(/Try again.*1 answer/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: /Try again/ })[0]);
    await screen.findByText("Verified answer");
    expect(screen.getByText(/Monthly allowance used/)).toBeTruthy();
    const turnPost = fetchMock.mock.calls.find(([url, init]) =>
      String(url).endsWith("/conversations/c-failed/turns") && init?.method === "POST");
    expect(JSON.parse(String(turnPost?.[1]?.body))).toEqual({
      requestId: "new-request",
      question: "What changed in the market?",
    });
    expect(JSON.parse(String(turnPost?.[1]?.body)).requestId).not.toBe("failed-turn");
  });
});
