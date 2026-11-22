import { z } from "zod";
import { outcomeInput, type OutcomeInput } from "@shared/win-loss";

export class WinLossError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const canEditOutcomes = (role: string) => ["Analyst", "Domain Admin", "Global Admin"].includes(role);
export const filterSchema = z.object({
  from: outcomeInput.innerType().shape.closeDate.unwrap().optional(),
  to: outcomeInput.innerType().shape.closeDate.unwrap().optional(),
  outcome: z.enum(["won", "lost", "no_decision"]).optional(),
  segment: z.string().max(160).optional(), competitorId: z.string().max(100).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
}).strict().refine(v => !v.from || !v.to || v.from <= v.to, "Start date must precede end date");
export function filterOutcomes<T extends OutcomeInput>(rows: T[], filters: z.infer<typeof filterSchema>) {
  return rows.filter(r => (!filters.from || !!r.closeDate && r.closeDate >= filters.from) &&
    (!filters.to || !!r.closeDate && r.closeDate <= filters.to) &&
    (!filters.outcome || r.outcome === filters.outcome) && (!filters.segment || r.segment === filters.segment) &&
    (!filters.competitorId || r.competitorConfirmed && r.competitorId === filters.competitorId) &&
    (!filters.currency || r.currency === filters.currency));
}
export function assertImportDecision(existing: { version: number } | undefined, decision: { expectedVersion: number | null; replace: boolean; reviewed: boolean }) {
  if (!decision.reviewed) throw new WinLossError("Review each selected deal before importing");
  if (existing && (!decision.replace || decision.expectedVersion !== existing.version)) throw new WinLossError("This deal already exists or changed. Preview again and explicitly review replacement of manual corrections.", 409);
  if (!existing && decision.expectedVersion !== null) throw new WinLossError("A reviewed deal was deleted. Preview again.", 409);
}
export const themeResponse = z.object({
  themes: z.array(z.object({ title: z.string().min(1).max(240), summary: z.string().min(1).max(3000), evidenceIds: z.array(z.string()).min(1).max(100) }).strict()).min(1).max(12),
  addition: z.string().max(8000).optional(),
}).strict();
export function validateThemes(raw: unknown, evidence: Array<OutcomeInput & { id: string }>, proposal: boolean) {
  const result = themeResponse.parse(raw);
  const ids = new Set(evidence.map(r => r.id));
  if (result.themes.some(t => t.evidenceIds.some(id => !ids.has(id)))) throw new WinLossError("AI returned an invalid evidence citation. Nothing was saved.", 502);
  if (proposal && !result.addition?.trim()) throw new WinLossError("AI did not provide a reviewable battlecard addition.", 502);
  if (proposal) {
    const citations = [...result.addition!.matchAll(/\[([^\]\n]+)\]/g)].map(match => match[1]);
    if (!citations.length || citations.some(id => !ids.has(id))) throw new WinLossError("Battlecard addition contained missing or invalid outcome citations. Nothing was saved.", 502);
  }
  const warnings = [
    ...(evidence.length < 10 ? [`Small sample: ${evidence.length} outcomes; themes are directional, not causal conclusions.`] : []),
    ...(evidence.some(r => !r.reasonCodes.length) ? [`${evidence.filter(r => !r.reasonCodes.length).length} outcomes have missing reasons; no reason may be inferred from missing data.`] : []),
  ];
  return { ...result, warnings };
}
