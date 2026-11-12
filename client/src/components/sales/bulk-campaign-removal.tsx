import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { campaignRemovalError, useCampaignRemoval } from "./use-campaign-removal";

interface BulkCampaignRemovalProps {
  campaignId: string;
  selectedIds: string[];
  selectionScope: string;
  canEdit: boolean;
  onRemoved: () => void;
}

/** Pass classification.selectedIds, selectionScope, canEdit and clearSelection directly. */
export default function BulkCampaignRemoval(props: BulkCampaignRemovalProps) {
  return <CampaignRemovalAction key={JSON.stringify([props.campaignId, props.selectionScope, props.selectedIds, props.canEdit])} {...props} />;
}

function CampaignRemovalAction({ campaignId, selectedIds, selectionScope, canEdit, onRemoved }: BulkCampaignRemovalProps) {
  const mutation = useCampaignRemoval(campaignId, canEdit);
  const { toast } = useToast();
  const [snapshot, setSnapshot] = useState<{ scope: string; ids: string[] } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const scope = JSON.stringify([campaignId, selectionScope, selectedIds, canEdit]);
  const ids = snapshot?.scope === scope ? snapshot.ids : null;
  const count = ids?.length ?? 0;
  const noun = count === 1 ? "contact" : "contacts";
  const validSelection = selectedIds.length > 0 && selectedIds.length <= 200 && new Set(selectedIds).size === selectedIds.length;

  return <>
    <Button type="button" variant="outline" size="sm" className="mb-3 h-8 text-xs" disabled={!canEdit || !validSelection || mutation.isPending}
      onClick={() => {
        mutation.reset();
        setConfirmed(false);
        setSnapshot({ scope, ids: [...selectedIds] });
      }} data-testid="bulk-campaign-removal-open">
      Remove selected from campaign ({selectedIds.length})
    </Button>
    <Dialog open={!!ids} onOpenChange={open => { if (!open && !mutation.isPending) setSnapshot(null); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Remove exactly {count} {noun} from this campaign?</DialogTitle>
          <DialogDescription>
            Only these {count} selected {noun} will leave this campaign’s active contact directory. Active outreach to them in this campaign will stop.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border bg-muted/20 p-3 text-sm leading-relaxed text-muted-foreground">
          All campaign touch history is retained in Removed contacts. Shared contacts, other campaigns and HubSpot records are kept. Nothing is deleted from HubSpot or any external system.
          <p className="mt-2">Removal does not recall messages, delete drafts already in Outlook, or cancel an external operation already in progress.</p>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={confirmed} disabled={mutation.isPending}
            onChange={event => setConfirmed(event.target.checked)} />
          <span>Remove exactly {count} selected {noun} from this campaign and stop their active outreach.</span>
        </label>
        {mutation.isError && <p role="alert" className="text-sm text-destructive">
          {campaignRemovalError(mutation.error)} Your selection is kept. Try again.
        </p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => setSnapshot(null)}>Cancel</Button>
          <Button type="button" variant="destructive" disabled={!canEdit || !confirmed || !count || count > 200 || mutation.isPending}
            onClick={async () => {
              if (!ids || !confirmed || !canEdit) return;
              try {
                const { removed } = await mutation.mutateAsync(ids);
                setSnapshot(null);
                onRemoved();
                toast({ title: `${removed} ${removed === 1 ? "contact" : "contacts"} removed from campaign`, description: "History and shared contacts are retained. Active outreach has stopped." });
              } catch { /* Keep the exact selection and confirmation available for retry. */ }
            }}>
            {mutation.isPending ? "Removing…" : `Remove ${count} ${noun} from campaign`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
