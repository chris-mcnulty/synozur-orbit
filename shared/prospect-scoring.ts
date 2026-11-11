import { z } from "zod";
export const scoringFactsSchema = z.object({
  title: z.string().trim().max(300),
  industry: z.string().trim().max(300),
  geography: z.string().trim().max(300),
  segment: z.string().trim().max(300),
}).strict();
export type ScoringFacts = z.infer<typeof scoringFactsSchema>;
export const rescoreRequestSchema = z.object({ facts: scoringFactsSchema.optional() }).strict();
export function effectiveScoringFacts(person: {
  title?: string | null;
  classification?: { scoringFacts?: ScoringFacts } | null;
  signals?: unknown;
}): ScoringFacts {
  const signals = person.signals as Record<string, unknown> | null;
  const text = (key: string) => typeof signals?.[key] === "string" ? signals[key] as string : "";
  return person.classification?.scoringFacts ?? {
    title: person.title ?? "", industry: text("industry"), geography: text("geography"), segment: text("segment"),
  };
}
