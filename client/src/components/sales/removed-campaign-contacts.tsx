import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { campaignRemovalError, useRemovedCampaignContacts, useRemovedContactTouches } from "./use-campaign-removal";

function HistoryLoading() {
  return <div role="status" aria-label="Loading history" className="space-y-3">
    <Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" />
  </div>;
}

/** Read-only for every role, including outreach editors. No sending or editing controls. */
export default function RemovedCampaignContacts({ campaignId, scope = "" }: { campaignId: string; scope?: string }) {
  return <RemovedContactsHistory key={JSON.stringify([campaignId, scope])} campaignId={campaignId} scope={scope} />;
}

function RemovedContactsHistory({ campaignId, scope }: { campaignId: string; scope: string }) {
  const [openedScope, setOpenedScope] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ scope: string; id: string } | null>(null);
  const context = JSON.stringify([campaignId, scope]);
  const open = openedScope === context;
  const contacts = useRemovedCampaignContacts(campaignId, open, scope);
  const person = open && selected?.scope === context ? contacts.data?.find(contact => contact.id === selected.id) : undefined;
  const touches = useRemovedContactTouches(campaignId, person?.id ?? null, scope);
  return <>
    <Button type="button" variant="outline" size="sm" className="mb-3 h-8 text-xs" onClick={() => {
      setSelected(null); setOpenedScope(context);
    }}>Removed contacts</Button>
    <Dialog open={open} onOpenChange={value => { if (!value) { setOpenedScope(null); setSelected(null); } }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Removed contacts</DialogTitle>
          <DialogDescription>Read-only campaign history. These contacts no longer receive active outreach from this campaign. Shared contacts and HubSpot records are retained.</DialogDescription>
        </DialogHeader>
        {contacts.isPending ? <HistoryLoading /> : contacts.isError ? <div role="alert" className="space-y-2 text-sm">
          <p className="text-destructive">Could not load removed contacts. {campaignRemovalError(contacts.error)}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void contacts.refetch()}>Retry loading contacts</Button>
        </div> : !contacts.data?.length ? <div className="rounded-md border bg-muted/20 p-6 text-sm">
          <p className="font-medium">No removed contacts</p>
          <p className="mt-1 text-muted-foreground">Contacts removed from this campaign will appear here with their retained touch history.</p>
        </div> : <>
          <ul aria-label="Removed campaign contacts" className="max-h-60 overflow-y-auto divide-y rounded-md border">
            {contacts.data.map(contact => <li key={contact.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0 text-sm"><p className="break-words font-medium">{contact.name}</p>
                <p className="break-words text-xs text-muted-foreground">{contact.companyName || "Company not recorded"}</p>
              </div>
              <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 text-xs" aria-label={`View campaign touch history for ${contact.name}`}
                aria-pressed={person?.id === contact.id} onClick={() => setSelected({ scope: context, id: contact.id })}>View history</Button>
            </li>)}
          </ul>
          {person && <section aria-label={`Campaign touch history for ${person.name}`} className="space-y-3">
            <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium">{person.name} · Campaign touch history</h3><Badge variant="secondary">Read-only</Badge></div>
            {touches.isPending ? <HistoryLoading /> : touches.isError ? <div role="alert" className="space-y-2 text-sm">
              <p className="text-destructive">Could not load touch history. {campaignRemovalError(touches.error)}</p>
              <Button type="button" size="sm" variant="outline" onClick={() => void touches.refetch()}>Retry loading history</Button>
            </div> : !touches.data?.length ? <p className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">No campaign touches were recorded for this contact.</p> :
              <ol className="space-y-3">{touches.data.map(touch => <li key={touch.id} className="rounded-md border p-3 text-sm">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Step {touch.stepNumber} · {touch.channel}</span><Badge variant="outline">{touch.status.replace(/_/g, " ")}</Badge>
                </div>
                {touch.subject && <h4 className="mb-1 break-words font-medium">{touch.subject}</h4>}
                <p className="whitespace-pre-wrap break-words text-muted-foreground">{touch.body || "No message content recorded."}</p>
              </li>)}</ol>}
          </section>}
        </>}
      </DialogContent>
    </Dialog>
  </>;
}
