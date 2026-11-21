import { useEffect, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "wouter";
import type { ZodType } from "zod";
import { useUser } from "@/lib/userContext";
import { getTabContextSnapshot, subscribeTabContext } from "@/lib/tabContext";
import { changeViews, emptyViews, readViews, validateDocument, viewStorageKey, MAX_VIEW_BYTES, type ViewAction } from "@/lib/personal-views";
import { urlViewState } from "@/lib/personal-view-schemas";

export function usePersonalViews<T extends Record<string, unknown>>({ surface, campaignId, schema, defaults }: {
  surface: string; campaignId?: string; schema: ZodType<T, any, any>; defaults: T;
}) {
  const { user } = useUser();
  const { data: context } = useQuery<{ activeTenantId: string | null; activeMarketId: string | null }>({
    queryKey: ["/api/context"], enabled: !!user,
  });
  const tabSnapshot = useSyncExternalStore(subscribeTabContext, getTabContextSnapshot, () => "[null,null]");
  const [tabTenantId, tabMarketId] = JSON.parse(tabSnapshot) as [string | null, string | null];
  const tenantId = tabTenantId ?? context?.activeTenantId;
  const marketId = tabMarketId ?? context?.activeMarketId ?? null;
  const key = user && tenantId ? viewStorageKey({ userId: user.id, tenantId, marketId, surface, campaignId }) : null;
  const search = useSearch();
  function load() {
    let loaded;
    try { loaded = key ? readViews(window.localStorage, key, schema, defaults) : { doc: emptyViews(defaults), notice: "" }; }
    catch { loaded = { doc: emptyViews(defaults), notice: "Browser storage is unavailable. Views will only last until you leave this page." }; }
    const candidate = { ...loaded.doc.last, ...urlViewState(defaults, search) };
    loaded.doc.last = schema.parse(candidate);
    if (JSON.stringify(candidate) !== JSON.stringify(loaded.doc.last)) loaded.notice = "Unavailable or invalid saved filters were reset.";
    return { ...loaded, key, search };
  }
  const [snapshot, setSnapshot] = useState(load);
  // Reset synchronously on identity/context changes: the previous user's search
  // must never render or be written into the new context, even for one effect.
  let current = snapshot;
  if (snapshot.key !== key) {
    current = load();
    setSnapshot(current);
  } else if (snapshot.search !== search) {
    const candidate = { ...snapshot.doc.last, ...urlViewState(defaults, search) };
    const last = schema.parse(candidate);
    current = { ...snapshot, search, doc: { ...snapshot.doc, last },
      notice: JSON.stringify(candidate) !== JSON.stringify(last) ? "Unavailable or invalid saved filters were reset." : snapshot.notice };
    setSnapshot(current);
  }
  const valid = validateDocument(current.doc, schema, defaults);
  const serialized = JSON.stringify(valid);
  const originalSerialized = JSON.stringify(current.doc);
  const pruned = serialized !== originalSerialized;
  const [writeError, setWriteError] = useState<{ key: string | null; message: string } | null>(null);
  useEffect(() => {
    if (!key) return;
    try {
      if (serialized.length > MAX_VIEW_BYTES) throw new Error("View storage limit reached");
      window.localStorage.setItem(key, serialized);
      setWriteError(null);
    } catch {
      setWriteError({ key, message: "Browser storage is unavailable or full. Changes work here but will not be remembered after leaving." });
    }
  }, [key, serialized]);
  useEffect(() => {
    if (pruned) setSnapshot(s => s.key === key && JSON.stringify(s.doc) === originalSerialized
      ? { ...s, doc: valid, notice: "Unavailable or invalid saved filters were reset." } : s);
  }, [key, serialized, originalSerialized, pruned]);

  function dispatch(action: ViewAction<T>) {
    const doc = changeViews(valid, action, defaults);
    if (action.type === "apply") doc.last = schema.parse({ ...doc.last, ...urlViewState(defaults, search) });
    setSnapshot(s => s.key !== key ? s : { ...s, doc });
  }
  function field<K extends keyof T>(name: K): [T[K], Dispatch<SetStateAction<T[K]>>] {
    return [valid.last[name], value => {
      setSnapshot(s => {
        if (s.key !== key) return s;
        const doc = validateDocument(s.doc, schema, defaults);
        const next = typeof value === "function" ? (value as (v: T[K]) => T[K])(doc.last[name]) : value;
        return { ...s, doc: { ...doc, last: schema.parse({ ...doc.last, [name]: next }) } };
      });
    }];
  }
  const active = valid.views.find(v => v.id === valid.activeId);
  return {
    scopeKey: key ?? "unavailable", state: valid.last, views: valid.views, activeId: valid.activeId, field, dispatch,
    dirty: !!active && JSON.stringify(active.state) !== JSON.stringify(valid.last),
    enabled: !!key,
    notice: writeError?.key === key ? writeError.message : current.notice,
    dismissNotice: () => setSnapshot(s => ({ ...s, notice: "" })),
  };
}
