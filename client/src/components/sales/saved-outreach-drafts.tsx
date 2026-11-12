import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Touch } from "@/pages/app/sales/campaign-detail";

interface Props {
  prospectId: string;
  prospectName: string;
  campaignId: string;
  scope: string;
  requestedDraftId?: string | null;
  onOpen: (touch: Touch) => void;
  onClose: () => void;
}

export default function SavedOutreachDrafts(props: Props) {
  const opened = useRef(false);
  const query = useQuery<Array<Touch & { campaignId: string }>>({
    queryKey: ["saved-outreach-drafts", props.scope, props.campaignId, props.prospectId],
    queryFn: async () => {
      const response = await fetch(`/api/sales-outreach/prospects/${encodeURIComponent(props.prospectId)}/touches`, { credentials: "include" });
      if (!response.ok) throw new Error("Could not load saved drafts. Please retry.");
      return response.json();
    },
    staleTime: 0,
    refetchOnMount: "always",
  });
  const drafts = (query.data ?? []).filter(t => t.campaignId === props.campaignId && t.status === "draft_pending_approval");
  useEffect(() => {
    if (opened.current || query.isFetching || !props.requestedDraftId) return;
    const match = drafts.find(t => t.id === props.requestedDraftId);
    if (match) {
      opened.current = true;
      props.onOpen(match);
    }
  }, [drafts, props.requestedDraftId, props.onOpen, query.isFetching]);
  return <Dialog open onOpenChange={open => { if (!open) props.onClose(); }}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Saved drafts — {props.prospectName}</DialogTitle>
        <DialogDescription>Open an existing draft to edit it in Orbit. Saving here does not require Outlook or send an email.</DialogDescription>
      </DialogHeader>
      {query.isPending || query.isFetching ? <p role="status">Loading saved drafts…</p>
        : query.isError ? <div role="alert">Could not load saved drafts. <Button variant="outline" onClick={() => query.refetch()}>Retry</Button></div>
        : <>
          {props.requestedDraftId && !drafts.some(t => t.id === props.requestedDraftId) && <p role="alert">That draft is no longer available for editing. It may already have been approved or removed.</p>}
          {!drafts.length && <p>No pending drafts for this contact in this campaign.</p>}
          {drafts.map(t => <div key={t.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div className="min-w-0"><p className="break-words font-medium">{t.subject || (t.channel === "email" ? "Untitled email" : "LinkedIn message")}</p>
              <p className="text-xs text-muted-foreground">{t.channel === "email" ? "Email" : "LinkedIn"} · Step {t.stepNumber}</p></div>
            <Button variant="outline" className="shrink-0" onClick={() => props.onOpen(t)}>Open draft</Button>
          </div>)}
        </>}
    </DialogContent>
  </Dialog>;
}
