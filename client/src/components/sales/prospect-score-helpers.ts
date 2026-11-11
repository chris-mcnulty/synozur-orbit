import { effectiveScoringFacts, type ScoringFacts } from "@shared/prospect-scoring";
import type { CampaignClassification } from "@shared/campaign-classification";

export interface ScoreSignal {
  key: string;
  label: string;
  weight: number;
  matched: boolean;
  absent?: boolean;
  note?: string;
}
export interface ScoreBreakdown {
  signals?: ScoreSignal[];
  total?: number;
  threshold?: number;
  matchedPersonaName?: string | null;
}
export interface ScorablePerson {
  id: string;
  name?: string;
  email?: string | null;
  title?: string | null;
  icpScore: number | null;
  classification?: CampaignClassification | null;
  signals?: Record<string, unknown> | null;
  scoreBreakdown?: ScoreBreakdown | null;
}
export interface ScoringCriteria {
  targetRoles?: string[];
  industries?: string[];
  geographies?: string[];
  segments?: string[];
}
export function scoreSignalState(signal: ScoreSignal): "missing" | "matched" | "mismatch" {
  return signal.absent ? "missing" : signal.matched ? "matched" : "mismatch";
}
/** Use explicit scorer evidence; only fall back to current required facts for legacy scores. */
export function missingScoringLabels(person: ScorablePerson, criteria?: ScoringCriteria | null): string[] {
  if (person.scoreBreakdown?.signals?.length) {
    return person.scoreBreakdown.signals.filter(signal => scoreSignalState(signal) === "missing").map(signal => signal.label);
  }
  const facts = effectiveScoringFacts(person);
  const fields: [keyof ScoringFacts, string, string[] | undefined][] = [
    ["title", "Title / role", criteria?.targetRoles],
    ["industry", "Industry", criteria?.industries],
    ["geography", "Geography", criteria?.geographies],
    ["segment", "Segment", criteria?.segments],
  ];
  return fields.filter(([key, , targets]) => targets?.length && !facts[key].trim()).map(([, label]) => label);
}
