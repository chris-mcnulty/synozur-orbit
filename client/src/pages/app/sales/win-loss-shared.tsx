import { useState, type ReactNode } from "react";
import { CircleAlert, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type OutcomeInput, type OutcomeRecord } from "@shared/win-loss";
import { apiRequest } from "@/lib/queryClient";
import { getTabContextSnapshot } from "@/lib/tabContext";

/** Reject queued requests from an unmounted workspace before headers are read. */
export function useOutcomeScopeGuard() {
  const [origin] = useState(getTabContextSnapshot);
  return () => {
    if (getTabContextSnapshot() !== origin) throw new Error("Tenant or market changed. Reopen this action in the current workspace.");
  };
}

export const BASE = "/api/sales/win-loss";
export const REASON_LABELS: Record<string, string> = {
  price: "Price", capabilities: "Capabilities", service: "Service", relationship: "Relationship",
  timing: "Timing", budget: "Budget", status_quo: "Status quo", other: "Other",
};
export const outcomeLabel = (value: string) => value === "no_decision" ? "No decision" : value.charAt(0).toUpperCase() + value.slice(1);
export const money = (value: string | null, currency: string | null) => value === null ? "Not provided" : `${currency ?? "Currency unknown"} ${value}`;
export const dateLabel = (value: string | null) => value ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "Undated";
export const apiJson = async <T,>(url: string): Promise<T> => (await apiRequest("GET", url)).json();
export const postJson = async <T,>(url: string, data: unknown): Promise<T> => (await apiRequest("POST", url, data)).json();

export type Competitor = { id: string; name: string };
export type Battlecard = { id: string; competitorId: string; customNotes: string | null };
export type Review = { id: string; kind: "themes" | "battlecard"; payload: any; approvedAt: string | null; approvedBy: string | null; createdAt: string };
export type DataSet = { records: OutcomeRecord[]; canEdit: boolean; competitors: Competitor[]; battlecards: Battlecard[]; reviews: Review[] };
export type Summary = {
  total: number; won: number; lost: number; noDecision: number; denominator: number; winRate: number | null;
  competitors: Array<{ name: string; total: number; won: number; lost: number; noDecision: number; denominator: number; winRate: number | null }>;
  segments: Array<{ name: string; total: number; won: number; lost: number; noDecision: number; denominator: number; winRate: number | null }>;
  currencies: Record<string, { count: number; won: string; lost: string; noDecision: string; total: string }>;
  coverage: Record<string, number>;
  scope: { from: string | null; to: string | null; dateBasis: "closeDate"; undatedExcluded: boolean };
};
export type Discovery = {
  properties: Array<{ name: string; label: string; options: Array<{ label: string; value: string }> }>;
  pipelines: Array<{ id: string; label: string; stages: Array<{ id: string; label: string; closed: boolean }> }>;
  portalId: string;
};
export type PreviewRow = { externalId: string; candidate: OutcomeInput; raw: Record<string, unknown>; competitorText: string | null; reasonText: string | null; warnings: string[]; existing: OutcomeRecord | null; competitorMatches: Competitor[] };
export type Preview = { id: string; portalId: string; rows: PreviewRow[]; expiresAt: string };
export type FilterState = { from: string; to: string; outcome: string; segment: string; competitorId: string; currency: string };
export const EMPTY_INPUT: OutcomeInput = {
  dealLabel: "", outcome: "won", closeDate: null, amount: null, currency: null, segment: null,
  competitorId: null, competitorConfirmed: false, reasonCodes: [], notes: "",
};

export function OutcomeBadge({ outcome }: { outcome: string }) {
  const cls = outcome === "won" ? "border-emerald-700/20 bg-emerald-700/10 text-emerald-800 dark:text-emerald-300" : outcome === "lost" ? "border-rose-700/20 bg-rose-700/10 text-rose-800 dark:text-rose-300" : "border-muted-foreground/20 bg-muted text-muted-foreground";
  return <Badge variant="outline" className={cls}>{outcomeLabel(outcome)}</Badge>;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <div className="flex min-h-52 flex-col items-center justify-center px-6 py-10 text-center"><div className="mb-4 rounded-full border bg-muted/50 p-3"><Search className="h-5 w-5 text-muted-foreground" /></div><h3 className="font-medium">{title}</h3><p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p>{action && <div className="mt-4">{action}</div>}</div>;
}

export function ErrorBanner({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = error instanceof Error ? error.message.replace(/^\d+:\s*/, "") : "The request could not be completed.";
  return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3"><div className="flex items-start gap-2 text-sm"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /><span>{message}</span></div><Button variant="outline" size="sm" onClick={onRetry}><RefreshCw className="mr-2 h-3.5 w-3.5" />Try again</Button></div>;
}

export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`block space-y-1.5 ${className}`}><span className="text-sm font-medium">{label}</span>{children}</label>;
}

export function PanelLoading({ label }: { label: string }) {
  return <div className="space-y-4" role="status" aria-label={label}><div className="h-16 animate-pulse rounded-lg bg-muted/50" /><div className="h-72 animate-pulse rounded-lg bg-muted/40" /></div>;
}

