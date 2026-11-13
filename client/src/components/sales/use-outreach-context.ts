import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { getTabMarketId, getTabTenantId } from "@/lib/tabContext";
import { contactFamiliarities, messagingGroups, type ContactFamiliarity, type ExternalActivityInput, type SegmentBrief } from "@shared/outreach-context";

export type MessagingGroup = SegmentBrief["group"];
export function matchesAssignedMessagingGroup(contact: { messagingGroup?: MessagingGroup | null }, filter: string) {
  return filter === "all" || (filter === "unassigned" ? !contact.messagingGroup : contact.messagingGroup === filter);
}
export function matchesContactFamiliarity(contact: { familiarity?: ContactFamiliarity | null }, filter: string) {
  return filter === "all" || (contact.familiarity ?? "unknown") === filter;
}
export type OutreachSettingsPatch = { messagingGroup?: MessagingGroup | null; familiarity?: ContactFamiliarity };
export function bulkOutreachInput(prospectIds: string[], patch: OutreachSettingsPatch) {
  if (!prospectIds.length || prospectIds.length > 200 || new Set(prospectIds).size !== prospectIds.length || prospectIds.some(id => !id.trim())) {
    throw new Error("Select between 1 and 200 unique contacts.");
  }
  if (patch.messagingGroup === undefined && patch.familiarity === undefined) throw new Error("Choose at least one setting to change.");
  if (patch.messagingGroup !== undefined && patch.messagingGroup !== null && !messagingGroups.includes(patch.messagingGroup)) throw new Error("Choose a valid messaging group.");
  if (patch.familiarity !== undefined && !contactFamiliarities.includes(patch.familiarity)) throw new Error("Choose a valid familiarity.");
  return { prospectIds, ...patch };
}
export interface ExternalActivity extends Omit<ExternalActivityInput, "direction"> {
  direction?: "outbound" | "inbound";
  id: string; createdAt: string; updatedAt: string;
}
export interface OutreachContext {
  activities: ExternalActivity[]; hold: boolean; messagingGroup: MessagingGroup | null; messagingGroupAutomatic?: boolean; familiarity: ContactFamiliarity;
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
    mutationFn: async (input: OutreachSettingsPatch & { hold?: boolean }): Promise<OutreachContext> =>
      (await apiRequest("PATCH", outreachPath(id), input)).json(),
    onSuccess: (context) => {
      qc.setQueryData(key, context);
      // Patch the canonical directory in place so its group filter updates immediately.
      qc.setQueriesData<({ id: string } & OutreachSettingsPatch)[]>({
        predicate: (query) => query.queryKey[0] === "/api/sales-outreach/campaigns" && query.queryKey.at(-1) === "prospects",
      }, (rows) => rows?.map((row) => row.id === id ? { ...row, messagingGroup: context.messagingGroup, messagingGroupAutomatic: context.messagingGroupAutomatic, familiarity: context.familiarity ?? "unknown" } : row));
    },
  });
  const activity = useMutation({
    mutationFn: async (action: { type: "save"; activityId?: string; input: ExternalActivityInput } | { type: "delete"; activityId: string }) => {
      const base = `/api/sales-outreach/prospects/${encodeURIComponent(id)}/external-activities`;
      const url = action.activityId ? `${base}/${encodeURIComponent(action.activityId)}` : base;
      await apiRequest(action.type === "delete" ? "DELETE" : action.activityId ? "PATCH" : "POST", url, action.type === "save" ? action.input : undefined);
      return fetchOutreachContext(id);
    },
    onSuccess: async (context) => {
      qc.setQueryData(key, context);
      // A shared activity can change directory summaries and stop the current cadence.
      await qc.invalidateQueries({
        predicate: query => query.queryKey.some(part => typeof part === "string" && (
          part.includes("/outreach-context") ||
          part.includes("/meetings")
        )) || (query.queryKey[0] === "/api/sales-outreach/campaigns" && query.queryKey.at(-1) === "prospects"),
      });
    },
  });
  return { settings, activity };
}
export function useBulkOutreachActions(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ prospectIds, patch }: { prospectIds: string[]; patch: OutreachSettingsPatch }) =>
      (await apiRequest("PATCH", `/api/sales-outreach/campaigns/${encodeURIComponent(campaignId)}/outreach-context`, bulkOutreachInput(prospectIds, patch))).json() as Promise<{ updated: number }>,
    onSuccess: async (_, { prospectIds, patch }) => {
      const ids = new Set(prospectIds);
      const directoryKey = ["/api/sales-outreach/campaigns", campaignId, "prospects"];
      qc.setQueriesData<({ id: string } & OutreachSettingsPatch)[]>({ queryKey: directoryKey },
        rows => rows?.map(row => ids.has(row.id) ? { ...row, ...patch } : row));
      // Never fabricate a context fingerprint. Active preflights refetch before continuing;
      // inactive contexts become stale and refetch when reopened.
      await Promise.all([
        qc.invalidateQueries({ queryKey: directoryKey }),
        ...prospectIds.map(id => qc.invalidateQueries({ queryKey: outreachKey(id) })),
      ]);
    },
  });
}
export function outreachError(error: unknown) {
  return error instanceof Error ? error.message.replace(/^\d+:\s*/, "") : "Could not save. Please try again.";
}
