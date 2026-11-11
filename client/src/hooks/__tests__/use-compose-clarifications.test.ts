// @vitest-environment jsdom
import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { composeClarificationKey, useComposeClarifications } from "../use-compose-clarifications";
const scope = "tenant:operator:campaign";
const vars = { prospect: { id: "avanade", name: "Example Person" }, channel: "email" as const, intent: "outreach", additionalContext: undefined as string | undefined };
const needsInput = { code: "OUTREACH_NEEDS_INPUT", message: "**Confirm event details**", questions: ["When is the event?"] };
afterEach(cleanup);
describe("persistent page-local compose clarifications", () => {
  it("preserves questions and answers when closed, and reopens the same recipient", () => {
    const { result } = renderHook(() => useComposeClarifications<typeof vars>(scope));
    act(() => result.current.reportFailure(needsInput, vars, scope));
    act(() => result.current.updateContext("November 18; follow up with our alliance lead."));
    act(() => result.current.setOpen(false));
    expect(result.current.open).toBe(false);
    expect(result.current.records).toHaveLength(1);
    act(() => result.current.resume(composeClarificationKey(vars)));
    expect(result.current.open).toBe(true);
    expect(result.current.recovery).toMatchObject({ vars, questions: needsInput.questions, additionalContext: "November 18; follow up with our alliance lead." });
  });
  it("keeps answers through repeated clarification and generic retry failures", () => {
    const { result } = renderHook(() => useComposeClarifications<typeof vars>(scope));
    act(() => result.current.reportFailure(needsInput, vars, scope));
    act(() => result.current.updateContext("The event is confirmed."));
    const retryVars = { ...vars, additionalContext: result.current.recovery!.additionalContext };
    act(() => result.current.reportFailure({ code: "OUTREACH_NEEDS_INPUT", message: "Who is attending?", questions: ["Who is attending?"] }, retryVars, scope));
    expect(result.current.recovery?.additionalContext).toBe("The event is confirmed.");
    act(() => result.current.reportFailure(new Error("Network disconnected"), retryVars, scope));
    expect(result.current.recovery).toMatchObject({ additionalContext: "The event is confirmed.", retryError: "Network disconnected", questions: ["Who is attending?"] });
  });
  it("opens a persistent recovery area for uncoded errors instead of a transient notification", () => {
    const { result } = renderHook(() => useComposeClarifications<typeof vars>(scope));
    act(() => result.current.reportFailure(new Error("Unexpected response"), vars, scope));
    expect(result.current.open).toBe(true);
    expect(result.current.recovery).toMatchObject({ code: "COMPOSE_FAILED", explanation: "Unexpected response" });
  });
  it("isolates answers across recipients, channels and intents", () => {
    const { result } = renderHook(() => useComposeClarifications(scope));
    act(() => result.current.reportFailure(needsInput, vars, scope));
    act(() => result.current.updateContext("Email-only facts"));
    const linkedIn = { ...vars, channel: "linkedin" as const };
    act(() => result.current.reportFailure(needsInput, linkedIn, scope));
    expect(result.current.recovery?.additionalContext).toBe("");
    act(() => result.current.updateContext("Connection note facts"));
    act(() => result.current.resume(composeClarificationKey(vars)));
    expect(result.current.recovery?.additionalContext).toBe("Email-only facts");
    expect(result.current.records).toHaveLength(2);
  });
  it("removes only the explicitly discarded or successfully completed context", () => {
    const { result } = renderHook(() => useComposeClarifications(scope));
    act(() => result.current.reportFailure(needsInput, vars, scope));
    const other = { ...vars, prospect: { id: "other", name: "Other Person" } };
    act(() => result.current.reportFailure(needsInput, other, scope));
    act(() => result.current.succeeded(vars, scope));
    expect(result.current.records).toHaveLength(1);
    expect(result.current.recovery?.vars.prospect.id).toBe("other");
    act(() => result.current.discard());
    expect(result.current.records).toHaveLength(0);
    expect(result.current.open).toBe(false);
  });
  it("clears notes on account/campaign changes and ignores stale in-flight responses", () => {
    const { result, rerender } = renderHook(({ activeScope }) => useComposeClarifications<typeof vars>(activeScope), { initialProps: { activeScope: scope } });
    act(() => result.current.reportFailure(needsInput, vars, scope));
    rerender({ activeScope: "other-tenant:operator:campaign" });
    expect(result.current.records).toEqual([]);
    act(() => result.current.reportFailure(needsInput, vars, scope));
    expect(result.current.records).toEqual([]);
    expect(result.current.open).toBe(false);
  });
});
