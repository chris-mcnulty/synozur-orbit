import { useMutation, useQueryClient } from "@tanstack/react-query";
import { scoringFactsSchema, type ScoringFacts } from "@shared/prospect-scoring";
import { apiRequest } from "@/lib/queryClient";
import { canClassifyCampaign } from "./campaign-classification-helpers";
import type { ScorablePerson, ScoreBreakdown } from "./prospect-score-helpers";

export interface RescoreResult {
  score: number;
  breakdown: ScoreBreakdown;
  facts: ScoringFacts;
}
export function useProspectRescore(campaignId: string, prospectId: string, role?: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (facts?: ScoringFacts): Promise<RescoreResult> => {
      if (!canClassifyCampaign(role)) throw new Error("Your role can inspect scores but cannot change scoring facts.");
      const body = facts === undefined ? {} : { facts: scoringFactsSchema.parse(facts) };
      const response = await apiRequest("POST", `/api/sales-outreach/campaigns/${campaignId}/prospects/${prospectId}/rescore`, body);
      return response.json();
    },
    onSuccess: (result, facts) => {
      // Patch only scoring fields; do not overwrite shared contact identity or other edits.
      queryClient.setQueryData<ScorablePerson[]>(["/api/sales-outreach/campaigns", campaignId, "prospects"], previous =>
        previous?.map(person => person.id === prospectId ? {
          ...person, icpScore: result.score, scoreBreakdown: result.breakdown,
          ...(facts !== undefined ? { classification: {
            tags: [], eventRoles: [], sourceDetail: "", ...person.classification, scoringFacts: result.facts,
          } } : {}),
        } : person));
      void queryClient.invalidateQueries({ queryKey: ["/api/sales-outreach/campaigns", campaignId, "prospects"] });
      void queryClient.invalidateQueries({ queryKey: [`/api/sales-outreach/campaigns/${campaignId}/meetings`] });
    },
  });
}
