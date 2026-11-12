import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { classificationPatchSchema, type ClassificationPatch } from "@shared/campaign-classification";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { canClassifyCampaign, emptyClassificationFilters, groupClassifiedPeople, matchesClassification, visibleSelectedIds, type ClassifiedPerson, type ClassificationGroupBy } from "./campaign-classification-helpers";

/**
 * Pass the existing search/status/score/source-filtered, sorted contacts as people.
 * Pass those filter values as filterScope so selection never survives a filter change.
 */
export function useCampaignClassification<T extends ClassifiedPerson>({ campaignId, people, role, filterScope = "" }: {
  campaignId: string; people: T[]; role?: string | null; filterScope?: string;
}) {
  const [filters, setFilters] = useState(emptyClassificationFilters);
  const [groupBy, setGroupBy] = useState<ClassificationGroupBy>("none");
  const [selection, setSelection] = useState<{ scope: string; ids: string[] }>({ scope: "", ids: [] });
  const [editor, setEditor] = useState<{ scope: string; ids: string[] } | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canEdit = canClassifyCampaign(role);
  const scope = JSON.stringify([campaignId, filterScope, filters, groupBy]);
  const filteredPeople = useMemo(() => people.filter(person => matchesClassification(person, filters)), [people, filters]);
  const groups = useMemo(() => groupClassifiedPeople(filteredPeople, groupBy), [filteredPeople, groupBy]);
  const selectedIds = selection.scope === scope ? visibleSelectedIds(selection.ids, filteredPeople) : [];
  const editingIds = editor?.scope === scope ? visibleSelectedIds(editor.ids, filteredPeople) : [];
  const editingPeople = filteredPeople.filter(person => editingIds.includes(person.id));
  const mutation = useMutation({
    mutationFn: async ({ prospectIds, patch }: { prospectIds: string[]; patch: ClassificationPatch }) => {
      if (!canEdit) throw new Error("Your role cannot edit classifications.");
      if (!prospectIds.length || prospectIds.length > 200) throw new Error("Select between 1 and 200 visible contacts.");
      const result = classificationPatchSchema.safeParse(patch);
      if (!result.success) throw new Error(result.error.issues[0]?.message ?? "Check the changes and try again.");
      const response = await apiRequest("PATCH", `/api/sales-outreach/campaigns/${campaignId}/prospects/classification`, { prospectIds, patch: result.data });
      return response.json() as Promise<{ updated: number }>;
    },
    onSuccess: async ({ updated }) => {
      setEditor(null);
      setSelection({ scope, ids: [] });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/sales-outreach/campaigns", campaignId, "prospects"] }),
        queryClient.invalidateQueries({ queryKey: [`/api/sales-outreach/campaigns/${campaignId}/meetings`] }),
      ]);
      toast({ title: `${updated} ${updated === 1 ? "contact" : "contacts"} updated` });
    },
  });
  function openEditor(ids: string[]) {
    if (!canEdit) return;
    mutation.reset();
    setEditor({ scope, ids: visibleSelectedIds(ids, filteredPeople) });
  }
  function togglePerson(id: string, checked: boolean) {
    if (!canEdit) return;
    setSelection({ scope, ids: visibleSelectedIds(checked ? [...selectedIds, id] : selectedIds.filter(value => value !== id), filteredPeople) });
  }
  return {
    filters, setFilters, groupBy, setGroupBy, filteredPeople, groups, selectedIds, canEdit,
    selectionScope: scope,
    clearSelection: () => setSelection({ scope, ids: [] }),
    membershipCount: groups.reduce((sum, group) => sum + group.people.length, 0),
    clearFilters: () => setFilters(emptyClassificationFilters()),
    togglePerson,
    toggleAll: (checked: boolean) => setSelection({ scope, ids: checked ? visibleSelectedIds(filteredPeople.map(person => person.id), filteredPeople) : [] }),
    openEditor, editingPeople,
    editorKey: JSON.stringify([editor?.scope, editingIds]),
    closeEditor: () => { if (!mutation.isPending) setEditor(null); },
    save: (patch: ClassificationPatch) => mutation.mutateAsync({ prospectIds: editingIds, patch }),
    isSaving: mutation.isPending,
    error: mutation.error instanceof Error ? mutation.error.message.replace(/^\d+:\s*/, "") : "",
  };
}
