import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  AlertCircle,
  ArrowUpRight,
  BookOpenCheck,
  Check,
  CircleStop,
  Clock3,
  FileSearch,
  LoaderCircle,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import { useUser } from "@/lib/userContext";
import { getTabContextHeaders, getTabMarketId, getTabTenantId } from "@/lib/tabContext";
import {
  consumeOrbitSse,
  mergeOrbitTurn,
  orbitContextKey,
  safeCitationPath,
  type OrbitConversation,
  type OrbitConversationSummary,
  type OrbitSseMessage,
  type OrbitTurn,
  type OrbitUsage,
  type OrbitWorkspace,
} from "./ask-orbit-helpers";

type ContextSnapshot = {
  key: string;
  headers: Record<string, string>;
  epoch: number;
};

type ReconnectTarget = {
  requestId: string;
  question: string;
  conversationId: string;
};

async function readError(response: Response) {
  try {
    const body = await response.json();
    return typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : response.statusText;
  } catch {
    return response.statusText || "The request could not be completed.";
  }
}

function dateLabel(value: string | null) {
  if (!value) return "Date not provided";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatUpdated(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const hours = (Date.now() - date.getTime()) / 36e5;
  if (hours < 24) return hours < 1 ? "Just now" : `${Math.floor(hours)}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function AskOrbitContext({ context }: { context: ContextSnapshot }) {
  const [workspace, setWorkspace] = useState<OrbitWorkspace | null>(null);
  const [conversation, setConversation] = useState<OrbitConversation | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [draftAnswer, setDraftAnswer] = useState("");
  const [streamStatus, setStreamStatus] = useState("");
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [screenError, setScreenError] = useState("");
  const [transportError, setTransportError] = useState("");
  const [gate, setGate] = useState<"enterprise" | "quota-config" | null>(null);
  const [reconnectTarget, setReconnectTarget] = useState<ReconnectTarget | null>(null);
  const turns = conversation?.turns ?? [];
  const aliveRef = useRef(true);
  const activeStreamRef = useRef<{
    requestId: string;
    conversationId: string;
    controller: AbortController;
    reader?: ReadableStreamDefaultReader<Uint8Array>;
  } | null>(null);
  const selectionRef = useRef(0);
  const submittingRef = useRef(false);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const turnsRef = useRef<OrbitTurn[]>([]);
  turnsRef.current = turns;
  const headers = useMemo(() => ({ ...context.headers }), [context.headers]);
  const remaining = workspace?.usage.remaining ?? 0;
  const isProcessing = turns.some((turn) => turn.status === "processing") || !!activeStreamRef.current;

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const requestHeaders = new Headers(headers);
    new Headers(init.headers).forEach((value, key) => requestHeaders.set(key, value));
    const response = await fetch(path, {
      ...init,
      headers: requestHeaders,
      credentials: "include",
    });
    if (!response.ok) throw Object.assign(new Error(await readError(response)), { status: response.status });
    return response;
  }, [headers]);

  const loadWorkspace = useCallback(async (showLoading = false) => {
    if (!aliveRef.current) return;
    if (showLoading) setLoadingWorkspace(true);
    setScreenError("");
    try {
      const response = await request("/api/ask-orbit");
      const data = await response.json() as OrbitWorkspace;
      if (!aliveRef.current) return;
      setWorkspace(data);
      setGate(null);
    } catch (error) {
      if (!aliveRef.current) return;
      const status = (error as { status?: number }).status;
      if (status === 403) setGate("enterprise");
      else if (status === 503) setGate("quota-config");
      else setScreenError((error as Error).message || "Ask Orbit is temporarily unavailable.");
    } finally {
      if (aliveRef.current) setLoadingWorkspace(false);
    }
  }, [request]);

  const loadConversation = useCallback(async (
    id: string,
    quiet = false,
    selection = selectionRef.current,
    preserveRecovery = false,
  ) => {
    if (!quiet && aliveRef.current) setLoadingConversation(true);
    try {
      const response = await request(`/api/ask-orbit/conversations/${encodeURIComponent(id)}`);
      const data = await response.json() as OrbitConversation;
      if (!aliveRef.current || selection !== selectionRef.current || activeIdRef.current !== id) return null;
      setConversation(data);
      if (!preserveRecovery) {
        setTransportError("");
        setReconnectTarget(null);
      }
      return data;
    } catch (error) {
      if (aliveRef.current && selection === selectionRef.current && activeIdRef.current === id && !quiet) {
        setScreenError((error as Error).message || "Could not open this conversation.");
      }
      return null;
    } finally {
      if (aliveRef.current && selection === selectionRef.current && !quiet) setLoadingConversation(false);
    }
  }, [request]);

  const selectConversation = (id: string) => {
    const selection = ++selectionRef.current;
    activeIdRef.current = id;
    setActiveId(id);
    setConversation(null);
    setDraftAnswer("");
    setStreamStatus("");
    setSaving(!!activeStreamRef.current);
    setScreenError("");
    setTransportError("");
    setReconnectTarget(null);
    void loadConversation(id, false, selection);
  };

  useEffect(() => {
    aliveRef.current = true;
    void loadWorkspace(true);
    let ending = false;
    const stopOldScope = () => {
      if (ending) return;
      ending = true;
      aliveRef.current = false;
      const stream = activeStreamRef.current;
      activeStreamRef.current = null;
      const pendingTurn = turnsRef.current.find((turn) => turn.status === "processing");
      const turnId = stream?.requestId ?? pendingTurn?.id;
      const conversationId = stream?.conversationId ?? activeIdRef.current;
      if (turnId && conversationId) {
        // Dispatch the stop using the captured scope before aborting the stream.
        void fetch(`/api/ask-orbit/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}/stop`, {
          method: "POST",
          headers: { ...headers },
          credentials: "include",
        }).catch(() => undefined);
      }
      stream?.reader?.cancel().catch(() => undefined);
      stream?.controller.abort();
    };
    window.addEventListener("tab-context-changed", stopOldScope);
    return () => {
      window.removeEventListener("tab-context-changed", stopOldScope);
      // Preserve the original context scope. Stop is sent before aborting the reader.
      stopOldScope();
    };
  }, [loadWorkspace, headers]);

  // Resume only by reading the same conversation. This does not create a new answer.
  useEffect(() => {
    if (!activeId || activeStreamRef.current?.conversationId === activeId) return;
    const processing = turns.some((turn) => turn.status === "processing");
    if (!processing) return;
    const timer = window.setInterval(() => {
      void loadConversation(activeId, true);
    }, 2400);
    return () => window.clearInterval(timer);
  }, [activeId, turns, loadConversation]);

  const newConversation = () => {
    selectionRef.current += 1;
    activeIdRef.current = null;
    setActiveId(null);
    setConversation(null);
    setSaving(!!activeStreamRef.current);
    setDraftAnswer("");
    setStreamStatus("");
    setQuestion("");
    setScreenError("");
    setTransportError("");
    setReconnectTarget(null);
  };

  const createConversation = useCallback(async (title: string) => {
    const response = await request("/api/ask-orbit/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    return await response.json() as { id: string; title: string };
  }, [request]);

  const handleSse = useCallback((
    message: OrbitSseMessage,
    requestId: string,
    conversationId: string,
    isCurrentSelection: boolean,
  ) => {
    if (message.type === "done") {
      if (!aliveRef.current) return;
      if (!isCurrentSelection) {
        setSaving(false);
        setDraftAnswer("");
        setStreamStatus("");
        return;
      }
    } else if (message.type === "error") {
      if (!aliveRef.current || !isCurrentSelection) return;
      setTransportError(message.message || "The answer could not be completed.");
      setReconnectTarget({ requestId, question: "", conversationId });
      return;
    } else if (!aliveRef.current || !isCurrentSelection) return;
    if (message.type === "start") {
      setStreamStatus("Finding the most relevant records…");
    } else if (message.type === "status") {
      setStreamStatus(message.message);
    } else if (message.type === "delta") {
      setDraftAnswer((text) => text + message.text);
    } else if (message.type === "done") {
      setConversation((current) => current
        ? { ...current, turns: mergeOrbitTurn(current.turns, message.turn) }
        : current);
      setDraftAnswer("");
      setStreamStatus("");
      setTransportError("");
      setReconnectTarget(null);
      setWorkspace((current) => current ? { ...current, usage: message.usage } : current);
    }
  }, []);

  const runQuestion = useCallback(async (requestId: string, questionText: string, existingConversationId?: string) => {
    // React state updates are asynchronous; guard same-tick double submits
    // before a second conversation or billable request can be created.
    if (submittingRef.current) return;
    submittingRef.current = true;
    const selection = selectionRef.current;
    const isCurrentSelection = () => aliveRef.current && selection === selectionRef.current;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    setSaving(true);
    setScreenError("");
    setTransportError("");
    setDraftAnswer("");
    setStreamStatus("Connecting to your records…");
    let conversationId = existingConversationId;
    try {
      if (!conversationId) {
        const created = await createConversation(questionText.slice(0, 76) || "New question");
        if (!isCurrentSelection()) return;
        conversationId = created.id;
        activeIdRef.current = created.id;
        setActiveId(created.id);
        setConversation({ id: created.id, title: created.title, turns: [] });
        setWorkspace((current) => current ? {
          ...current,
          conversations: [{ id: created.id, title: created.title, updatedAt: new Date().toISOString() }, ...current.conversations],
        } : current);
      }
      if (!isCurrentSelection() || !conversationId) return;
      const controller = new AbortController();
      activeStreamRef.current = { requestId, conversationId, controller };
      const response = await request(`/api/ask-orbit/conversations/${encodeURIComponent(conversationId)}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ requestId, question: questionText }),
        signal: controller.signal,
      });
      if (!response.body) throw new Error("This connection did not return a live answer stream.");
      reader = response.body.getReader();
      const stream = activeStreamRef.current;
      if (stream?.requestId === requestId && stream.conversationId === conversationId) stream.reader = reader;
      const decoder = new TextDecoder();
      let remainder = "";
      let finished = false;
      let serverErrored = false;
      while (!finished) {
        const { value, done } = await reader.read();
        if (!isCurrentSelection()) {
          // The request may finish in the background, but its callbacks cannot affect another selection.
          if (done) break;
        }
        if (done) {
          const tail = consumeOrbitSse(`${remainder}\n\n`);
          tail.messages.forEach((message) => {
            if (message.type === "error") serverErrored = true;
            handleSse(message, requestId, conversationId!, isCurrentSelection());
            if (message.type === "done") finished = true;
          });
          if (!finished && !serverErrored) throw new Error("The answer stream ended before the answer was confirmed.");
          break;
        }
        const parsed = consumeOrbitSse(remainder + decoder.decode(value, { stream: true }));
        remainder = parsed.remainder;
        parsed.messages.forEach((message) => {
          if (message.type === "error") serverErrored = true;
          handleSse(message, requestId, conversationId!, isCurrentSelection());
          if (message.type === "done") finished = true;
        });
      }
      if (activeStreamRef.current?.requestId === requestId) activeStreamRef.current = null;
      reader.releaseLock();
      if (aliveRef.current && !isCurrentSelection()) {
        setSaving(false);
        setDraftAnswer("");
        setStreamStatus("");
      }
      if (isCurrentSelection() && conversationId) {
        if (serverErrored) {
          setReconnectTarget({ requestId, question: questionText, conversationId });
        }
        void loadConversation(conversationId, true, selection, serverErrored);
        void loadWorkspace();
      }
    } catch (error) {
      if (reader) {
        await reader.cancel().catch(() => undefined);
        try { reader.releaseLock(); } catch { /* reader already released */ }
      }
      if (activeStreamRef.current?.requestId === requestId) activeStreamRef.current = null;
      if (!isCurrentSelection() || (error as Error).name === "AbortError") {
        if (aliveRef.current && activeStreamRef.current?.requestId !== requestId) {
          setSaving(false);
          setDraftAnswer("");
          setStreamStatus("");
        }
        return;
      }
      setStreamStatus("");
      setTransportError((error as Error).message || "Connection interrupted. The answer may still be processing.");
      void loadWorkspace();
      if (conversationId) {
        setReconnectTarget({ requestId, question: questionText, conversationId });
        void loadConversation(conversationId, true, selection, true);
      }
    } finally {
      submittingRef.current = false;
      if (isCurrentSelection()) setSaving(false);
    }
  }, [createConversation, handleSse, loadConversation, loadWorkspace, request]);

  const submitQuestion = (event: React.FormEvent) => {
    event.preventDefault();
    const clean = question.trim();
    if (!clean || saving || remaining < 1) return;
    setQuestion("");
    void runQuestion(crypto.randomUUID(), clean, activeId ?? undefined);
  };

  const reconnect = () => {
    const target = reconnectTarget;
    if (!target || target.conversationId !== activeIdRef.current) return;
    // Transport recovery is read-only: never submit another POST, even as a replay.
    void loadConversation(target.conversationId, false, selectionRef.current);
  };

  const stopAnswer = async () => {
    const active = activeStreamRef.current;
    const currentId = activeIdRef.current;
    const processingTurn = turns.find((turn) => turn.status === "processing");
    const currentStream = processingTurn ? null : active;
    const conversationId = processingTurn ? currentId : active?.conversationId ?? currentId;
    const turnId = processingTurn?.id ?? currentStream?.requestId;
    if (!turnId || !conversationId) return;
    setStopping(true);
    // Dispatch the scoped stop first, then abort the local stream immediately.
    const stopRequest = fetch(`/api/ask-orbit/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}/stop`, {
        method: "POST",
        headers: { ...headers },
        credentials: "include",
      }).catch(() => undefined);
    currentStream?.reader?.cancel().catch(() => undefined);
    currentStream?.controller.abort();
    if (activeStreamRef.current === currentStream) activeStreamRef.current = null;
    try {
      await stopRequest;
    } finally {
      if (!aliveRef.current) {
        return;
      }
      setSaving(false);
      setStopping(false);
      setDraftAnswer("");
      setStreamStatus("");
      setReconnectTarget(null);
      if (conversationId === activeIdRef.current) void loadConversation(conversationId, true);
      void loadWorkspace();
    }
  };

  const retryFailedTurn = (turn: OrbitTurn) => {
    if (saving || remaining < 1) return;
    void runQuestion(crypto.randomUUID(), turn.question, activeId ?? undefined);
  };

  const renameConversation = async (item: OrbitConversationSummary) => {
    const nextTitle = window.prompt("Rename this conversation", item.title)?.trim();
    if (!nextTitle || nextTitle === item.title) return;
    try {
      await request(`/api/ask-orbit/conversations/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle }),
      });
      if (!aliveRef.current) return;
      setWorkspace((current) => current ? {
        ...current,
        conversations: current.conversations.map((entry) => entry.id === item.id ? { ...entry, title: nextTitle } : entry),
      } : current);
      setConversation((current) => current?.id === item.id ? { ...current, title: nextTitle } : current);
    } catch (error) {
      if (!aliveRef.current) return;
      setScreenError((error as Error).message || "Could not rename this conversation.");
    }
  };

  const deleteConversation = async (item: OrbitConversationSummary) => {
    if (!window.confirm(`Delete “${item.title}”? This cannot be undone.`)) return;
    try {
      await request(`/api/ask-orbit/conversations/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      if (!aliveRef.current) return;
      setWorkspace((current) => current ? {
        ...current,
        conversations: current.conversations.filter((entry) => entry.id !== item.id),
      } : current);
      if (activeId === item.id) newConversation();
    } catch (error) {
      if (!aliveRef.current) return;
      setScreenError((error as Error).message || "Could not delete this conversation.");
    }
  };

  const retryable = conversation?.turns.filter((turn) => turn.status === "failed" || turn.status === "cancelled") ?? [];
  const enterpriseGate = gate === "enterprise";
  const quotaMisconfigured = gate === "quota-config";

  return (
    <div className="min-h-[calc(100dvh-5rem)] bg-[#f3f5f7] text-[#172531]">
      <div className="mx-auto max-w-[1440px] px-4 pb-8 pt-5 sm:px-6 lg:px-9">
        <header className="mb-6 flex flex-col gap-4 border-b border-[#d8e0e5] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.18em] text-[#56717e]">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#dfe9e8] text-[#315a62]"><Sparkles size={14} /></span>
              Intelligence workspace <span className="text-[#9aaab0]">/</span> Verified answers
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-[-.04em] text-[#152a37] sm:text-[38px]">Ask Orbit</h1>
            <p className="mt-1 max-w-xl text-sm text-[#667985]">Ask questions of your existing records. Every answer points back to its evidence.</p>
          </div>
          {!gate && workspace && (
            <div className="flex items-center gap-3 rounded-xl border border-[#d5e0e2] bg-[#e9f0ef] px-4 py-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#d3e2df] text-[#315a62]"><BookOpenCheck size={17} /></div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#66817f]">Monthly answers</p>
                <p className="mt-0.5 text-sm font-semibold text-[#243d48]"><span className="font-mono">{workspace.usage.remaining}</span> remaining <span className="font-normal text-[#74868d]">of {workspace.usage.limit}</span></p>
              </div>
              <div className="ml-2 hidden h-8 w-8 items-center justify-center rounded-full border border-[#c7d6d4] text-[#496a70] sm:flex"><ShieldCheck size={15} /></div>
            </div>
          )}
        </header>

        {enterpriseGate || quotaMisconfigured ? (
          <section className="mx-auto mt-12 max-w-2xl rounded-2xl border border-[#d6e0e3] bg-[#fbfcfc] px-7 py-9 text-center shadow-[0_18px_55px_rgba(36,61,72,.07)]">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e7efed] text-[#315a62]"><ShieldCheck size={25} /></div>
            <p className="mt-5 text-xs font-bold uppercase tracking-[.18em] text-[#6b858b]">{enterpriseGate ? "Enterprise workspace" : "Usage controls unavailable"}</p>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-.03em] text-[#203642]">
              {enterpriseGate ? "A clearer view of your own intelligence." : "Ask Orbit is temporarily paused."}
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-[#687c85]">
              {enterpriseGate
                ? "Ask Orbit is available on Enterprise and Unlimited plans. Your existing records stay right where they are; upgrade to question them with source-by-source verification."
                : "The monthly answer allowance is not configured for this workspace. No question has been sent. Please contact your Orbit administrator."}
            </p>
            {enterpriseGate && <Link href="/pricing" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#244b54] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#183d46]">Explore Enterprise <ArrowUpRight size={15} /></Link>}
          </section>
        ) : loadingWorkspace ? (
          <div className="grid min-h-[460px] grid-cols-1 gap-5 lg:grid-cols-[260px_1fr]">
            <div className="animate-pulse rounded-2xl border border-[#dce3e7] bg-[#e9eef1]" />
            <div className="animate-pulse rounded-2xl border border-[#dce3e7] bg-[#e9eef1]" />
          </div>
        ) : (
          <div className="grid items-start gap-5 lg:grid-cols-[278px_minmax(0,1fr)]">
            <aside className="rounded-2xl border border-[#dce3e7] bg-[#fafbfb] p-3 shadow-[0_8px_30px_rgba(34,58,70,.035)]">
              <button onClick={newConversation} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#244b54] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#193e47] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#779b96]">
                <Plus size={16} /> New question
              </button>
              <div className="mb-2 mt-6 flex items-center justify-between px-2">
                <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#86969d]">Recent conversations</p>
                <span className="font-mono text-[10px] text-[#95a3a8]">{workspace?.conversations.length ?? 0}</span>
              </div>
              <div className="max-h-[calc(100dvh-330px)] space-y-1 overflow-y-auto">
                {workspace?.conversations.map((item) => (
                  <div key={item.id} className={`group rounded-xl transition ${activeId === item.id ? "bg-[#e9f0ef]" : "hover:bg-[#f0f4f5]"}`}>
                    <button onClick={() => { setScreenError(""); selectConversation(item.id); }} className="flex w-full items-start gap-2.5 px-3 py-3 text-left">
                      <MessageSquareText className={`mt-0.5 shrink-0 ${activeId === item.id ? "text-[#3f6970]" : "text-[#92a2a8]"}`} size={15} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-[#364c56]">{item.title}</span>
                        <span className="mt-1 flex items-center gap-1 text-[10px] text-[#8c9ba1]"><Clock3 size={11} />{formatUpdated(item.updatedAt)}</span>
                      </span>
                    </button>
                    <details className="relative">
                      <summary aria-label={`Actions for ${item.title}`} className="absolute right-2 top-[-38px] flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-md text-[#8b9ba0] opacity-0 hover:bg-white hover:text-[#344c56] group-hover:opacity-100 focus:opacity-100">
                        <MoreHorizontal size={15} />
                      </summary>
                      <div className="absolute right-1 top-[-8px] z-20 w-40 rounded-lg border border-[#dce4e7] bg-white p-1 shadow-lg">
                        <button onClick={() => void renameConversation(item)} className="w-full rounded px-2.5 py-2 text-left text-xs text-[#425963] hover:bg-[#f1f5f5]">Rename</button>
                        <button onClick={() => void deleteConversation(item)} className="w-full rounded px-2.5 py-2 text-left text-xs text-[#9b4f4b] hover:bg-[#fbefed]">Delete conversation</button>
                      </div>
                    </details>
                  </div>
                ))}
                {!workspace?.conversations.length && (
                  <div className="rounded-xl border border-dashed border-[#d9e2e5] px-4 py-6 text-center">
                    <FileSearch className="mx-auto text-[#9aabb0]" size={19} />
                    <p className="mt-2 text-xs font-medium text-[#687d86]">Your questions will live here.</p>
                    <p className="mt-1 text-[11px] leading-4 text-[#91a0a5]">Start with a decision, risk, or market shift.</p>
                  </div>
                )}
              </div>
              <div className="mt-4 border-t border-[#e5eaec] px-2 pt-3">
                <p className="text-[10px] leading-4 text-[#8a999f]">Ask Orbit reads your intelligence records. It does not modify them.</p>
              </div>
            </aside>

            <main className="min-h-[620px] overflow-hidden rounded-2xl border border-[#dce3e7] bg-[#fbfcfc] shadow-[0_10px_38px_rgba(34,58,70,.045)]">
              {screenError && (
                <div role="alert" className="m-4 flex items-center gap-3 rounded-xl border border-[#ebd3ce] bg-[#fff7f5] px-4 py-3 text-sm text-[#874f47]">
                  <AlertCircle size={17} /><span className="flex-1">{screenError}</span>
                  <button onClick={() => void loadWorkspace(true)} className="font-semibold underline underline-offset-2">Retry</button>
                  <button aria-label="Dismiss error" onClick={() => setScreenError("")}><X size={15} /></button>
                </div>
              )}
              {loadingConversation ? (
                <div className="space-y-4 p-7">
                  <div className="h-8 w-1/3 animate-pulse rounded-lg bg-[#eaf0f1]" />
                  <div className="h-24 animate-pulse rounded-xl bg-[#eaf0f1]" />
                  <div className="h-40 animate-pulse rounded-xl bg-[#eaf0f1]" />
                </div>
              ) : !conversation ? (
                <div className="flex min-h-[620px] flex-col">
                  <div className="flex flex-1 flex-col justify-center px-6 py-12 sm:px-12">
                    <div className="max-w-2xl">
                      <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#dbe6e4] bg-[#eff5f3] px-3 py-1.5 text-[11px] font-semibold text-[#52716f]"><span className="h-1.5 w-1.5 rounded-full bg-[#6a988b]" /> Grounded in your records</div>
                      <h2 className="font-display text-3xl font-semibold leading-[1.12] tracking-[-.045em] text-[#203642] sm:text-[42px]">Start with the question<br className="hidden sm:block" /> behind the decision.</h2>
                      <p className="mt-4 max-w-xl text-[15px] leading-7 text-[#6c7f87]">Ask about your market, customers, competitors, or strategy. Orbit will show what the records support—and where they fall short.</p>
                      <div className="mt-8 grid gap-2 sm:grid-cols-2">
                        {[
                          "What has changed in our competitors’ positioning this quarter?",
                          "Which customer needs appear most often in recent evidence?",
                          "Where are our current growth assumptions least supported?",
                        ].map((suggestion) => (
                          <button key={suggestion} onClick={() => setQuestion(suggestion)} className="group flex items-start gap-3 rounded-xl border border-[#e0e7e9] bg-white px-4 py-3.5 text-left text-[13px] leading-5 text-[#506670] transition hover:border-[#b9cfcc] hover:bg-[#f7faf9]">
                            <ArrowUpRight size={15} className="mt-0.5 shrink-0 text-[#77958f] transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {activeStreamRef.current && (
                    <div className="border-t border-[#e8edef] px-6 py-3">
                      <button onClick={() => void stopAnswer()} disabled={stopping} className="flex items-center gap-2 rounded-lg border border-[#e3d2cf] px-3 py-2 text-xs font-semibold text-[#9a5149] hover:bg-[#fff5f3] disabled:opacity-50">
                        {stopping ? <LoaderCircle size={14} className="animate-spin" /> : <CircleStop size={14} />}
                        {stopping ? "Stopping…" : "Stop answer running in another conversation"}
                      </button>
                    </div>
                  )}
                  <QuestionComposer question={question} setQuestion={setQuestion} onSubmit={submitQuestion} disabled={saving || remaining < 1} remaining={remaining} />
                </div>
              ) : (
                <div className="flex min-h-[620px] flex-col">
                  <div className="flex items-center justify-between border-b border-[#e4eaec] px-5 py-4 sm:px-7">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#8a9ba0]">Conversation</p>
                      <h2 className="mt-1 truncate text-sm font-semibold text-[#334b56]">{conversation.title}</h2>
                    </div>
                    <button onClick={() => void loadConversation(conversation.id)} className="flex items-center gap-2 rounded-lg border border-[#dce5e7] px-3 py-2 text-xs font-medium text-[#627982] hover:bg-[#f3f7f7]"><RefreshCw size={13} /> Refresh</button>
                  </div>
                  <div className="flex-1 space-y-7 px-4 py-6 sm:px-8 sm:py-8">
                    {turns.map((turn) => <TurnView key={turn.id} turn={turn} onRetry={() => retryFailedTurn(turn)} canRetry={remaining > 0} />)}
                    {saving && (
                      <article className="animate-in fade-in duration-300">
                        <div className="flex gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#e8efee] text-[#477079]"><Sparkles size={15} /></div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-xs font-semibold text-[#4e6871]"><LoaderCircle className="animate-spin" size={13} /> {streamStatus || "Working from your records"}</div>
                            {draftAnswer && <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[#405661]">{draftAnswer}</p>}
                            {!draftAnswer && <div className="mt-4 space-y-2"><div className="h-3 w-[84%] animate-pulse rounded bg-[#edf1f2]" /><div className="h-3 w-[69%] animate-pulse rounded bg-[#edf1f2]" /><div className="h-3 w-[45%] animate-pulse rounded bg-[#edf1f2]" /></div>}
                          </div>
                        </div>
                      </article>
                    )}
                    {transportError && (
                      <div role="alert" className="flex items-start gap-3 rounded-xl border border-[#ecd9c8] bg-[#fff9f1] p-4 text-sm text-[#785e44]">
                        <AlertCircle className="mt-0.5 shrink-0" size={17} />
                        <div className="flex-1"><p className="font-semibold">Connection interrupted</p><p className="mt-1 leading-5">{transportError} Check the existing conversation; Orbit will not submit another request.</p></div>
                        {reconnectTarget && <button onClick={reconnect} className="shrink-0 rounded-lg border border-[#e2cdb7] px-3 py-2 text-xs font-semibold hover:bg-[#fff3e4]">Check existing answer</button>}
                      </div>
                    )}
                    {retryable.map((turn) => (
                      <div key={`${turn.id}-retry`} className="rounded-xl border border-[#e8ded3] bg-[#fcf8f3] px-4 py-3 text-xs text-[#80674e]">
                        An answer can be tried again for <strong>1 answer</strong>. {turn.status === "cancelled" ? "This answer was stopped." : turn.error || "The answer could not be completed."}
                      </div>
                    ))}
                  </div>
                  {isProcessing && (
                    <div className="border-t border-[#e8edef] px-4 py-3 sm:px-8">
                      <button onClick={() => void stopAnswer()} disabled={stopping} className="flex items-center gap-2 rounded-lg border border-[#e3d2cf] px-3 py-2 text-xs font-semibold text-[#9a5149] hover:bg-[#fff5f3] disabled:opacity-50">
                        {stopping ? <LoaderCircle size={14} className="animate-spin" /> : <CircleStop size={14} />}
                        {stopping ? "Stopping…" : "Stop answer"}
                      </button>
                    </div>
                  )}
                  {retryable.length > 0 && remaining > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#ede6df] bg-[#fcf9f6] px-4 py-3 text-xs text-[#80674e] sm:px-8">
                      <span>Try again uses <strong>1 answer</strong>. {remaining} remain this month.</span>
                      <div className="flex gap-2">
                        {retryable.map((turn) => <button key={turn.id} onClick={() => retryFailedTurn(turn)} disabled={saving} className="rounded-lg border border-[#dfcdb9] px-3 py-2 font-semibold hover:bg-white disabled:opacity-50">Try again · 1 answer</button>)}
                      </div>
                    </div>
                  )}
                  <QuestionComposer question={question} setQuestion={setQuestion} onSubmit={submitQuestion} disabled={saving || remaining < 1 || isProcessing} remaining={remaining} />
                </div>
              )}
              {remaining < 1 && !gate && (
                <div className="flex items-center gap-2 border-t border-[#ebddd1] bg-[#fcf7f1] px-5 py-3 text-xs text-[#7e664f]">
                  <AlertCircle size={15} /> Monthly allowance used. New questions are available when the allowance renews.
                </div>
              )}
            </main>
          </div>
        )}
      </div>
    </div>
  );
}

function QuestionComposer({ question, setQuestion, onSubmit, disabled, remaining }: {
  question: string;
  setQuestion: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  disabled: boolean;
  remaining: number;
}) {
  return (
    <form onSubmit={onSubmit} className="border-t border-[#e4eaec] bg-[#f7f9f9] px-4 py-4 sm:px-7">
      <label htmlFor="orbit-question" className="sr-only">Ask your records</label>
      <div className="rounded-xl border border-[#d6e0e3] bg-white p-2 shadow-[0_3px_12px_rgba(35,62,73,.04)] focus-within:border-[#9db8b4] focus-within:ring-2 focus-within:ring-[#d9e7e4]">
        <textarea id="orbit-question" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); (event.currentTarget.form as HTMLFormElement)?.requestSubmit(); }
        }} rows={2} maxLength={2000} placeholder="Ask a question of your intelligence…" className="max-h-40 min-h-[54px] w-full resize-y border-0 bg-transparent px-2 py-1.5 text-sm leading-6 text-[#344c57] outline-none placeholder:text-[#9ba9ae]" />
        <div className="flex items-center justify-between gap-3 border-t border-[#eef1f2] px-1 pt-2">
          <div className="flex items-center gap-2 text-[10px] text-[#8c9ba0]"><ShieldCheck size={13} className="text-[#73938b]" /> Answers cite existing records <span className="hidden sm:inline">· {remaining} answers available</span></div>
          <button type="submit" disabled={disabled || !question.trim()} className="flex h-9 items-center gap-2 rounded-lg bg-[#244b54] px-3.5 text-xs font-semibold text-white transition hover:bg-[#193e47] disabled:cursor-not-allowed disabled:bg-[#b9c6c9]">
            Ask Orbit <ArrowUpRight size={14} />
          </button>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-[#97a3a7]">Enter to ask · Shift + Enter for a new line. Each submitted question uses 1 attempt, including failed, stopped or insufficient answers. Your organization shares a monthly allowance, renewed on the first day of each month (UTC).</p>
    </form>
  );
}

function TurnView({ turn, onRetry, canRetry }: { turn: OrbitTurn; onRetry: () => void; canRetry: boolean }) {
  const answer = turn.answer;
  return (
    <article className="space-y-4">
      <div className="ml-auto max-w-[90%] rounded-2xl rounded-br-sm bg-[#e8eff0] px-4 py-3.5 sm:max-w-[82%]">
        <p className="text-[10px] font-bold uppercase tracking-[.13em] text-[#71868c]">Your question</p>
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-[#344c56]">{turn.question}</p>
      </div>
      {turn.status === "processing" ? (
        <div className="flex gap-3 rounded-xl border border-[#e2e9ea] bg-[#f8faf9] p-4">
          <LoaderCircle className="mt-0.5 shrink-0 animate-spin text-[#5c8580]" size={16} />
          <div><p className="text-xs font-semibold text-[#526a72]">Answer is still processing</p><p className="mt-1 text-xs text-[#87979d]">You can refresh or stop the answer. It will not be submitted again.</p></div>
        </div>
      ) : turn.status === "failed" || turn.status === "cancelled" ? (
        <div className="flex items-start gap-3 rounded-xl border border-[#eaded7] bg-[#fcf8f5] p-4">
          <AlertCircle className="mt-0.5 shrink-0 text-[#a06b5e]" size={16} />
          <div className="flex-1"><p className="text-xs font-semibold text-[#765c54]">{turn.status === "cancelled" ? "Answer stopped" : "Answer could not be completed"}</p><p className="mt-1 text-xs leading-5 text-[#907b72]">{turn.error || "No verified answer was returned."}</p>
            {canRetry && <button onClick={onRetry} className="mt-3 rounded-lg border border-[#dfcdb9] bg-white px-3 py-2 text-xs font-semibold text-[#785e44] hover:bg-[#fff9f1]">Try again · uses 1 answer</button>}
          </div>
        </div>
      ) : answer ? (
        <div className="flex gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#e8efee] text-[#477079]"><Sparkles size={15} /></div>
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.13em] text-[#63817e]"><Check size={13} /> Evidence-backed answer</div>
            <p className="whitespace-pre-wrap text-sm leading-7 text-[#405661]">{answer.text}</p>
            {answer.limitations?.length > 0 && <div className="mt-4 rounded-lg border border-[#e8dfd2] bg-[#fcf8f1] px-3.5 py-3">
              <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#957a53]">Limitations</p>
              <ul className="mt-1.5 list-inside list-disc space-y-1 text-xs leading-5 text-[#7e705d]">{answer.limitations.map((limitation, i) => <li key={`${i}-${limitation}`}>{limitation}</li>)}</ul>
            </div>}
            {answer.citations?.length ? (
              <section className="mt-5 border-t border-[#e8edef] pt-4">
                <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-[#71858c]"><BookOpenCheck size={14} /> Sources · {answer.citations.length}</div>
                <div className="space-y-2">
                  {answer.citations.map((citation, i) => {
                    const path = safeCitationPath(citation.url);
                    return <div key={`${citation.sourceId}-${i}`} className="rounded-xl border border-[#e1e8e9] bg-[#fafcfc] px-3.5 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#edf2f1] font-mono text-[9px] font-semibold text-[#648079]">{String(i + 1).padStart(2, "0")}</span>
                          {path ? <Link href={path} className="truncate text-xs font-semibold text-[#355b64] underline decoration-[#cad8d8] underline-offset-2 hover:text-[#23434b]">{citation.title}<ArrowUpRight className="ml-1 inline" size={11} /></Link> : <span className="truncate text-xs font-semibold text-[#435a63]">{citation.title}</span>}
                        </div>
                        <time className="shrink-0 text-[10px] text-[#91a0a4]">{dateLabel(citation.date)}</time>
                      </div>
                      {citation.quote && <blockquote className="mt-2 border-l-2 border-[#c8d8d5] pl-3 text-xs leading-5 text-[#71848a]">“{citation.quote}”</blockquote>}
                      {citation.stale && <p className="mt-2 flex items-center gap-1.5 text-[10px] font-medium text-[#986d3c]"><Clock3 size={12} /> This source may be out of date.</p>}
                    </div>;
                  })}
                </div>
              </section>
            ) : (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-[#e9e3d6] bg-[#faf8f1] px-3.5 py-3 text-xs leading-5 text-[#82785f]"><FileSearch size={15} className="mt-0.5 shrink-0" /> No source records were attached to this answer. Verify before relying on it.</div>
            )}
          </div>
        </div>
      ) : <div className="rounded-xl border border-[#e3e9ea] px-4 py-3 text-xs text-[#819096]">No answer or evidence was returned for this turn.</div>}
    </article>
  );
}

export default function AskOrbitPage() {
  const { user } = useUser();
  const [version, setVersion] = useState(0);
  const [switching, setSwitching] = useState(false);
  const tenantId = getTabTenantId();
  const marketId = getTabMarketId();
  const key = orbitContextKey(user?.id ?? null, tenantId, marketId);
  const snapshot = useMemo<ContextSnapshot>(() => ({
    key,
    headers: { ...getTabContextHeaders() },
    epoch: version,
  }), [key, version]);

  useEffect(() => {
    const changed = () => {
      setSwitching(true);
      setVersion((value) => value + 1);
    };
    window.addEventListener("tab-context-changed", changed);
    return () => window.removeEventListener("tab-context-changed", changed);
  }, []);

  useEffect(() => {
    setSwitching(false);
  }, [key, version]);

  return (
    <AppLayout breadcrumbs={[{ label: "Ask Orbit" }]}>
      {switching ? (
        <div className="min-h-[calc(100dvh-6rem)] bg-[#f3f5f7] p-8">
          <div className="mx-auto max-w-5xl animate-pulse space-y-4">
            <div className="h-10 w-48 rounded-lg bg-[#e4eaed]" />
            <div className="grid h-[520px] gap-5 lg:grid-cols-[278px_1fr]"><div className="rounded-2xl bg-[#e9eef1]" /><div className="rounded-2xl bg-[#e9eef1]" /></div>
          </div>
        </div>
      ) : <AskOrbitContext key={`${snapshot.key}:${snapshot.epoch}`} context={snapshot} />}
    </AppLayout>
  );
}
