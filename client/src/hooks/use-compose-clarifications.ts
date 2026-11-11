import { useEffect, useRef, useState } from "react";

export interface ComposeClarificationTarget {
  prospect: { id: string; name: string };
  channel?: "email" | "linkedin";
  linkedinFormat?: string;
  intent?: string;
  additionalContext?: string;
}
export interface ComposeClarification<T extends ComposeClarificationTarget> {
  vars: T; code: string; explanation: string; questions: string[];
  additionalContext: string; retryError: string;
}
export function composeClarificationKey(vars: ComposeClarificationTarget) {
  return JSON.stringify([vars.prospect.id, vars.channel ?? "email", vars.linkedinFormat ?? "", vars.intent ?? "outreach"]);
}

/** Page-local notes; closing a dialog never discards the seller's answers. */
export function useComposeClarifications<T extends ComposeClarificationTarget>(scope: string) {
  type State = { scope: string; records: Record<string, ComposeClarification<T>>; active: string | null; open: boolean };
  const empty = (): State => ({ scope, records: {}, active: null, open: false });
  const [state, setState] = useState<State>(empty);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  useEffect(() => { setState(current => current.scope === scope ? current : empty()); }, [scope]);
  const current = state.scope === scope ? state : empty();
  const recovery = current.active ? current.records[current.active] ?? null : null;

  function reportFailure(error: unknown, vars: T, requestScope: string) {
    if (requestScope !== scopeRef.current) return;
    const e = error as { code?: string; message?: string; questions?: unknown };
    const key = composeClarificationKey(vars);
    setState(previous => {
      if (requestScope !== scopeRef.current) return previous;
      const base = previous.scope === scope ? previous : empty();
      const existing = base.records[key];
      const known = ["OUTREACH_NEEDS_INPUT", "OUTREACH_REFUSED", "OUTREACH_INVALID_DRAFT"].includes(e?.code ?? "");
      const message = e?.message || "Drafting could not finish. Please try again.";
      const questions = Array.isArray(e?.questions) ? e.questions.filter((q): q is string => typeof q === "string") : [];
      const entry: ComposeClarification<T> = {
        vars, code: known ? e.code! : existing?.code ?? "COMPOSE_FAILED",
        explanation: known || !existing ? message : existing.explanation,
        questions: known || !existing ? questions : existing.questions,
        additionalContext: vars.additionalContext ?? existing?.additionalContext ?? "",
        retryError: !known && existing ? message : "",
      };
      return { scope, records: { ...base.records, [key]: entry }, active: key, open: true };
    });
  }
  function updateContext(value: string) {
    setState(previous => {
      if (previous.scope !== scope || !previous.active || !previous.records[previous.active]) return previous;
      const entry = previous.records[previous.active];
      return { ...previous, records: { ...previous.records, [previous.active]: { ...entry, additionalContext: value, retryError: "" } } };
    });
  }
  function remove(key: string) {
    setState(previous => {
      if (previous.scope !== scope) return previous;
      const records = { ...previous.records };
      delete records[key];
      return { ...previous, records, active: previous.active === key ? null : previous.active, open: previous.active === key ? false : previous.open };
    });
  }
  return {
    scope, recovery, open: current.open, records: Object.entries(current.records),
    reportFailure, updateContext,
    setOpen: (open: boolean) => setState(previous => previous.scope === scope ? { ...previous, open } : previous),
    resume: (key: string) => setState(previous => previous.scope === scope && previous.records[key] ? { ...previous, active: key, open: true } : previous),
    discard: () => { if (current.active) remove(current.active); },
    succeeded: (vars: T, requestScope: string) => { if (requestScope === scopeRef.current) remove(composeClarificationKey(vars)); },
  };
}
