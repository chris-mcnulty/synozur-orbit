import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { getTabMarketId, getTabTenantId } from "@/lib/tabContext";

export interface RemovedCampaignContact {
  id: string;
  name: string;
  companyName: string | null;
  removedAt: string | null;
}

export interface CampaignTouchHistory {
  id: string;
  stepNumber: number;
  channel: string;
  status: string;
  subject: string | null;
  body: string | null;
}

export function campaignRemovalError(error: unknown) {
  return error instanceof Error ? error.message.replace(/^\d+:\s*/, "") : "Please try again.";
}

export function campaignRemovalInput(prospectIds: string[], canEdit: boolean) {
  if (!canEdit) throw new Error("Your role cannot remove campaign contacts.");
  if (!prospectIds.length || prospectIds.length > 200 || new Set(prospectIds).size !== prospectIds.length || prospectIds.some(id => !id.trim())) {
    throw new Error("Select between 1 and 200 unique visible contacts.");
  }
  return { prospectIds, confirmed: true as const };
}

export function useCampaignRemoval(campaignId: string, canEdit: boolean) {
  const queryClient = useQueryClient();
  const marketId = getTabMarketId();
  return useMutation({
    mutationFn: async (prospectIds: string[]) => {
      const response = await apiRequest("POST", `/api/sales-outreach/campaigns/${encodeURIComponent(campaignId)}/prospects/remove`, campaignRemovalInput(prospectIds, canEdit));
      return response.json() as Promise<{ removed: number }>;
    },
    onSuccess: () => {
      // Invalidate both active and removed directory keys, and the campaign rollups.
      void queryClient.invalidateQueries({ queryKey: ["/api/sales-outreach/campaigns", campaignId, "prospects"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/sales-outreach/campaigns", marketId, campaignId, "performance"] });
      void queryClient.invalidateQueries({ queryKey: [`/api/sales-outreach/campaigns/${campaignId}/meetings`] });
    },
  });
}

export function useRemovedCampaignContacts(campaignId: string, enabled: boolean, scope: string) {
  return useQuery<RemovedCampaignContact[]>({
    queryKey: ["/api/sales-outreach/campaigns", campaignId, "prospects", "removed", getTabTenantId(), getTabMarketId(), scope],
    enabled,
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/sales-outreach/campaigns/${encodeURIComponent(campaignId)}/prospects?removed=true`);
      return response.json();
    },
  });
}

export function useRemovedContactTouches(campaignId: string, prospectId: string | null, scope: string) {
  return useQuery<CampaignTouchHistory[]>({
    queryKey: ["/api/sales-outreach/prospects", prospectId, "touches", "removed", campaignId, getTabTenantId(), getTabMarketId(), scope],
    enabled: !!prospectId,
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/sales-outreach/prospects/${encodeURIComponent(prospectId!)}/touches`);
      return response.json();
    },
  });
}
