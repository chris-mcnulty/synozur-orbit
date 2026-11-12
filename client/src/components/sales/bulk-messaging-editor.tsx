import { useState } from "react";
import { contactFamiliarities, familiarityLabels, messagingGroups, messagingGroupLabels, type ContactFamiliarity } from "@shared/outreach-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { outreachError, useBulkOutreachActions, type MessagingGroup, type OutreachSettingsPatch } from "./use-outreach-context";

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
export default function BulkMessagingEditor({ campaignId, selectedIds, canEdit, onSaved }: {
  campaignId: string; selectedIds: string[]; canEdit: boolean; onSaved: () => void;
}) {
  const [ids, setIds] = useState<string[] | null>(null);
  const [group, setGroup] = useState("unchanged");
  const [familiarity, setFamiliarity] = useState("unchanged");
  const [confirmed, setConfirmed] = useState(false);
  const mutation = useBulkOutreachActions(campaignId);
  const { toast } = useToast();
  const count = ids?.length ?? 0;
  const changed = group !== "unchanged" || familiarity !== "unchanged";
  return <>
    <Button variant="outline" size="sm" className="mb-3 h-8 text-xs" disabled={!canEdit || !selectedIds.length || selectedIds.length > 200} onClick={() => {
      mutation.reset(); setGroup("unchanged"); setFamiliarity("unchanged"); setConfirmed(false); setIds([...selectedIds]);
    }} data-testid="bulk-messaging-open">Edit messaging for {selectedIds.length} selected</Button>
    <Dialog open={!!ids} onOpenChange={open => { if (!open && !mutation.isPending) setIds(null); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Edit messaging · {count} {count === 1 ? "contact" : "contacts"}</DialogTitle>
          <DialogDescription>Only these {count} selected contacts in this campaign will change. Selection is limited to 200 contacts per update; other visible contacts are not included.</DialogDescription></DialogHeader>
        <fieldset disabled={mutation.isPending} className="space-y-4">
          <label className="block space-y-1.5 text-sm font-medium">Messaging group
            <select className={selectClass} value={group} onChange={e => { setGroup(e.target.value); setConfirmed(false); }}>
              <option value="unchanged">Leave messaging group unchanged</option>
              <option value="unassigned">Shared campaign brief / no group</option>
              {messagingGroups.map(value => <option key={value} value={value}>{messagingGroupLabels[value]}</option>)}
            </select>
          </label>
          <label className="block space-y-1.5 text-sm font-medium">Familiarity with campaign sender
            <select className={selectClass} value={familiarity} onChange={e => { setFamiliarity(e.target.value); setConfirmed(false); }}>
              <option value="unchanged">Leave familiarity unchanged</option>
              {contactFamiliarities.map(value => <option key={value} value={value}>{familiarityLabels[value]}</option>)}
            </select>
          </label>
          <p className="rounded-md border bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">Familiarity is relative to this campaign’s sender, not a global person trait. Unknown is the default. These settings do not imply consent, alter communication status, or send messages. Classification stays unchanged.</p>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
            <span>Apply these changes to exactly {count} selected {count === 1 ? "contact" : "contacts"}.</span>
          </label>
        </fieldset>
        {mutation.isError && <p role="alert" className="text-sm text-destructive">{outreachError(mutation.error)} Your choices are kept. Try saving again.</p>}
        <DialogFooter><Button variant="outline" disabled={mutation.isPending} onClick={() => setIds(null)}>Cancel</Button>
          <Button disabled={!canEdit || !changed || !confirmed || !count || count > 200 || mutation.isPending} onClick={async () => {
            if (!ids) return;
            const patch: OutreachSettingsPatch = {};
            if (group !== "unchanged") patch.messagingGroup = group === "unassigned" ? null : group as MessagingGroup;
            if (familiarity !== "unchanged") patch.familiarity = familiarity as ContactFamiliarity;
            try {
              const { updated } = await mutation.mutateAsync({ prospectIds: ids, patch });
              setIds(null); onSaved();
              toast({ title: `Messaging updated for ${updated} ${updated === 1 ? "contact" : "contacts"}` });
            } catch { /* Mutation error is shown without losing the chosen settings. */ }
          }}>{mutation.isPending ? "Saving…" : `Save for ${count} ${count === 1 ? "contact" : "contacts"}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
