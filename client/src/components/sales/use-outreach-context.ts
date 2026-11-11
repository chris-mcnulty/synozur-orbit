import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { getTabMarketId, getTabTenantId } from "@/lib/tabContext";
import type { ExternalActivityInput, SegmentBrief } from "@shared/outreach-context";

export type MessagingGroup = SegmentBrief["group"];
export function matchesAssignedMessagingGroup(contact: { messagingGroup?: MessagingGroup | null }, filter: string) {
  return filter === "all" || (filter === "unassigned" ? !contact.messagingGroup : contact.messagingGroup === filter);
}
export interface ExternalActivity extends ExternalActivityInput {
  id: string; createdAt: string; updatedAt: string;
}
export interface OutreachContext {
  activities: ExternalActivity[]; hold: boolean; messagingGroup: MessagingGroup | null;
  briefs: SegmentBrief[]; fingerprint: string; recentActivity: boolean;
}
export const outreachPath = (id: string) => `/api/sales-outreach/prospects/${encodeURIComponent(id)}/outreach-context`;
export const outreachKey = (id: string) => [outreachPath(id), getTabTenantId(), getTabMarketId()];
export async function fetchOutreachContext(id: string): Promise<OutreachContext> {
  return (await apiRequest("GET", outreachPath(id))).json();
}
export function useOutreachContext(id: string | null) {
  return useQuery<OutreachContext>({
    queryKey: outreachKey(id ?? ""), enabled: !!id,
    queryFn: () => fetchOutreachContext(id!), staleTime: 0,
  });
}
export function useOutreachActions(id: string) {
  const qc = useQueryClient();
  const key = outreachKey(id);
  const settings = useMutation({
    mutationFn: async (input: { hold?: boolean; messagingGroup?: MessagingGroup | null }): Promise<OutreachContext> =>
      (await apiRequest("PATCH", outreachPath(id), input)).json(),
    onSuccess: (context) => {
      qc.setQueryData(key, context);
      // Patch the canonical directory in place so its group filter updates immediately.
      qc.setQueriesData<{ id: string; messagingGroup?: MessagingGroup | null }[]>({
        predicate: (query) => query.queryKey[0] === "/api/sales-outreach/campaigns" && query.queryKey.at(-1) === "prospects",
      }, (rows) => rows?.map((row) => row.id === id ? { ...row, messagingGroup: context.messagingGroup } : row));
    },
  });
  const activity = useMutation({
    mutationFn: async (action: { type: "save"; activityId?: string; input: ExternalActivityInput } | { type: "delete"; activityId: string }) => {
      const base = `/api/sales-outreach/prospects/${encodeURIComponent(id)}/external-activities`;
      const url = action.activityId ? `${base}/${encodeURIComponent(action.activityId)}` : base;
      await apiRequest(action.type === "delete" ? "DELETE" : action.activityId ? "PATCH" : "POST", url, action.type === "save" ? action.input : undefined);
      return fetchOutreachContext(id);
    },
    onSuccess: (context) => qc.setQueryData(key, context),
  });
  return { settings, activity };
}
export function outreachError(error: unknown) {
  return error instanceof Error ? error.message.replace(/^\d+:\s*/, "") : "Could not save. Please try again.";
}
