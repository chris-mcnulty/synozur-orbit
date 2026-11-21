import type { ZodType } from "zod";

export const MAX_VIEWS = 20;
export const MAX_VIEW_BYTES = 64_000;
export interface ViewContext {
  userId: string;
  tenantId: string;
  marketId: string | null;
  surface: string;
  campaignId?: string;
}
export interface PersonalView<T> { id: string; name: string; state: T }
export interface ViewDocument<T> { version: 1; last: T; views: PersonalView<T>[]; activeId: string | null }
export const emptyViews = <T>(defaults: T): ViewDocument<T> => ({ version: 1, last: defaults, views: [], activeId: null });
export function viewStorageKey(context: ViewContext) {
  return `orbit.personal-views:${JSON.stringify([context.userId, context.tenantId, context.marketId, context.surface, context.campaignId ?? null])}`;
}
export function validateDocument<T>(input: unknown, schema: ZodType<T>, defaults: T): ViewDocument<T> {
  if (!input || typeof input !== "object" || (input as any).version !== 1) throw new Error("Unsupported saved-view version");
  const doc = input as Record<string, unknown>;
  const views: PersonalView<T>[] = [];
  if (!Array.isArray(doc.views) || doc.views.length > MAX_VIEWS) throw new Error("Invalid saved views");
  for (const entry of doc.views) {
    if (!entry || typeof entry.id !== "string" || entry.id.length > 100 || !entry.id ||
        typeof entry.name !== "string" || !entry.name.trim() || views.some(v => v.id === entry.id)) continue;
    views.push({ id: entry.id, name: entry.name.trim().slice(0, 60), state: schema.parse(entry.state) });
  }
  return {
    version: 1,
    last: schema.parse(doc.last ?? defaults),
    views,
    activeId: typeof doc.activeId === "string" && views.some(v => v.id === doc.activeId) ? doc.activeId : null,
  };
}
export function readViews<T>(storage: Pick<Storage, "getItem">, key: string, schema: ZodType<T>, defaults: T) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return { doc: emptyViews(defaults), notice: "" };
    if (raw.length > MAX_VIEW_BYTES) throw new Error("Oversized saved views");
    const input = JSON.parse(raw);
    const doc = validateDocument(input, schema, defaults);
    return { doc, notice: JSON.stringify(input) !== JSON.stringify(doc) ? "Unavailable or invalid saved filters were reset." : "" };
  } catch {
    return { doc: emptyViews(defaults), notice: "Saved views could not be read. Defaults are shown; saving again will replace invalid local preferences." };
  }
}
export type ViewAction<T> =
  | { type: "change"; state: T }
  | { type: "create"; id: string; name: string }
  | { type: "apply" | "update" | "delete"; id: string }
  | { type: "rename"; id: string; name: string }
  | { type: "reset" };
export function changeViews<T>(doc: ViewDocument<T>, action: ViewAction<T>, defaults: T): ViewDocument<T> {
  const name = "name" in action ? action.name.trim().slice(0, 60) : "";
  if (action.type === "change") return { ...doc, last: action.state };
  if (action.type === "reset") return { ...doc, last: defaults, activeId: null };
  if (action.type === "create") {
    if (!name) throw new Error("Enter a view name.");
    if (doc.views.length >= MAX_VIEWS) throw new Error(`You can save up to ${MAX_VIEWS} views per workspace.`);
    if (doc.views.some(v => v.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("A view with this name already exists.");
    return { ...doc, activeId: action.id, views: [...doc.views, { id: action.id, name, state: doc.last }] };
  }
  const view = doc.views.find(v => v.id === action.id);
  if (!view) throw new Error("This saved view is no longer available.");
  if (action.type === "apply") return { ...doc, last: view.state, activeId: view.id };
  if (action.type === "delete") return { ...doc, views: doc.views.filter(v => v.id !== view.id), activeId: doc.activeId === view.id ? null : doc.activeId };
  if (action.type === "rename" && (!name || doc.views.some(v => v.id !== view.id && v.name.toLocaleLowerCase() === name.toLocaleLowerCase()))) throw new Error("Enter a unique view name.");
  return { ...doc, views: doc.views.map(v => v.id !== view.id ? v : action.type === "update" ? { ...v, state: doc.last } : { ...v, name }) };
}
