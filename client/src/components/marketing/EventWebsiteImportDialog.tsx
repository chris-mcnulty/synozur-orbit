import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { CalendarDays, CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { getTabMarketId } from "@/lib/tabContext";

interface WebsiteEvent {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  location?: string | null;
  timezone?: string | null;
  registrationUrl?: string | null;
  sessions: {
    id: string;
    title: string;
    sessionType?: string | null;
    speakers?: string | null;
    track?: string | null;
    room?: string | null;
    startTime?: string | null;
    sessionUrl?: string | null;
  }[];
}

interface ImportResult {
  conferenceId: string;
  eventUpdated: boolean;
  sessionsAdded: number;
  sessionsUpdated: number;
  sessionsSkipped: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

// Mount a fresh form for each opening (and market), including mutation state.
export default function EventWebsiteImportDialog(props: Props) {
  return props.open ? <EventWebsiteImportForm key={getTabMarketId()} {...props} /> : null;
}

function EventWebsiteImportForm({ open, onOpenChange, onImported }: Props) {
  const queryClient = useQueryClient();
  const marketId = getTabMarketId();
  const [source, setSource] = useState("");
  const [previewSource, setPreviewSource] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const status = useQuery<{ connected: boolean; lastError?: string | null }>({
    queryKey: ["/api/integrations/website/status", marketId],
    queryFn: async () => (await apiRequest("GET", "/api/integrations/website/status")).json(),
    retry: false,
    staleTime: 0,
  });
  const preview = useQuery<{ event: WebsiteEvent }>({
    queryKey: ["/api/conferences/website-preview", marketId, previewSource],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/conferences/website-preview?source=${encodeURIComponent(previewSource!)}`);
      const data = await response.json();
      if (!data?.event?.title || !Array.isArray(data.event.sessions)) {
        throw new Error("The website returned incomplete event details. Check the source URL or slug and try again.");
      }
      return data;
    },
    enabled: previewSource !== null,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const event = previewSource === source.trim() && !preview.isFetching && !preview.isError
    ? preview.data?.event : undefined;
  const importEvent = useMutation({
    mutationFn: async (reviewedSource: string) => {
      if (!event || !confirmed || reviewedSource !== previewSource || getTabMarketId() !== marketId) {
        throw new Error("Preview and confirm the event again before importing.");
      }
      return (await apiRequest("POST", "/api/conferences/import-website", { source: reviewedSource })).json() as Promise<ImportResult>;
    },
    onSuccess: (result) => {
      // Prefix invalidation refreshes the list and the existing detail key
      // ["/api/conferences", conferenceId], as well as market-scoped variants.
      void queryClient.invalidateQueries({ queryKey: ["/api/conferences"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/conferences", result.conferenceId] });
      void queryClient.invalidateQueries({ queryKey: ["/api/mcp-website/candidates", marketId] });
      onImported?.();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!importEvent.isPending) onOpenChange(next); }}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarDays className="w-5 h-5" /> Import event & schedule</DialogTitle>
          <DialogDescription>Preview an event from your connected website before importing its details and sessions into Event Promotion.</DialogDescription>
        </DialogHeader>
        {importEvent.data ? (
          <div className="space-y-4" role="status">
            <div className="rounded-md border bg-muted/30 p-4 space-y-2">
              <h3 className="font-medium flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Import complete</h3>
              <p className="text-sm">Event imported{importEvent.data.eventUpdated ? " (details updated)" : ""}. Sessions: {importEvent.data.sessionsAdded} added, {importEvent.data.sessionsUpdated} updated, {importEvent.data.sessionsSkipped} skipped.</p>
              <p className="text-xs text-muted-foreground">Importing the same source again updates matching records without duplicating sessions.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              <Button asChild><Link href={`/app/marketing/conferences/${encodeURIComponent(importEvent.data.conferenceId)}`} onClick={() => onOpenChange(false)}>Open Event Promotion</Link></Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-2" aria-live="polite">
              {status.isPending ? <p className="text-muted-foreground">Checking website connection…</p> : status.isError ? (
                <><p className="text-destructive">Could not check website connection: {status.error.message}</p><Button size="sm" variant="outline" onClick={() => void status.refetch()}>Retry connection check</Button></>
              ) : (
                <>
                  <p>{status.data.connected ? "Connected website" : "Website unavailable — connect your website in Settings → Integrations, then retry."}</p>
                  {status.data.lastError && <p className="text-destructive break-words">Website error: {status.data.lastError}</p>}
                  {!status.data.connected && <Button size="sm" variant="outline" onClick={() => void status.refetch()}>Retry connection check</Button>}
                </>
              )}
            </div>
            <form className="space-y-2" onSubmit={(e) => {
              e.preventDefault();
              if (!source.trim() || importEvent.isPending || preview.isFetching) return;
              setConfirmed(false);
              importEvent.reset();
              if (previewSource === source.trim()) void preview.refetch();
              else setPreviewSource(source.trim());
            }}>
              <Label htmlFor="event-website-source">Event URL or slug</Label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input id="event-website-source" placeholder="https://your-website.com/events/your-event or your-event" value={source} disabled={importEvent.isPending} onChange={(e) => {
                  setSource(e.target.value);
                  setPreviewSource(null);
                  setConfirmed(false);
                  importEvent.reset();
                }} />
                <Button type="submit" variant="outline" disabled={!source.trim() || preview.isFetching || importEvent.isPending}>
                  {preview.isFetching ? "Loading preview…" : "Preview event"}
                </Button>
              </div>
            </form>
            {preview.isFetching && <div className="space-y-2" role="status" aria-label="Loading event and schedule preview"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>}
            {previewSource && preview.isError && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <p>Could not load event & schedule: {preview.error.message}</p>
              <p className="mt-1">Check the URL or slug and your website connection, then select Preview event to retry.</p>
            </div>}
            {event && (
              <div className="space-y-4">
                <div className="rounded-md border p-4 space-y-2">
                  <h3 className="font-semibold break-words">{event.title}</h3>
                  <dl className="text-sm space-y-1">
                    <div><dt className="inline text-muted-foreground">Dates: </dt><dd className="inline">{event.startDate || "Not provided"}{event.endDate ? ` – ${event.endDate}` : ""}</dd></div>
                    <div><dt className="inline text-muted-foreground">Location: </dt><dd className="inline">{event.location || "Not provided"}</dd></div>
                    <div><dt className="inline text-muted-foreground">Timezone: </dt><dd className="inline">{event.timezone || "Not provided by source"}</dd></div>
                  </dl>
                  {event.description && <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words max-h-32 overflow-y-auto">{event.description}</p>}
                  <p className="text-xs text-muted-foreground">Dates and session times are shown exactly as provided by the source. No missing times or timezone are assumed.</p>
                </div>
                <div>
                  <h4 className="text-sm font-medium mb-2">Schedule preview · {event.sessions.length} session{event.sessions.length !== 1 ? "s" : ""}</h4>
                  {event.sessions.length === 0 ? (
                    <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">No sessions were returned by the website. You can import event details only, or check that the website has published a schedule and preview again.</div>
                  ) : (
                    <ul className="max-h-64 overflow-y-auto rounded-md border divide-y">
                      {event.sessions.map((session, index) => <li key={`${session.id}-${index}`} className="p-3 space-y-1">
                        <div className="flex flex-wrap gap-2 items-start"><span className="text-sm font-medium break-words">{session.title}</span>{session.sessionType && <Badge variant="secondary">{session.sessionType}</Badge>}</div>
                        {session.speakers && <p className="text-sm break-words">{session.speakers}</p>}
                        <p className="text-xs text-muted-foreground break-words">{session.startTime || "Start time not provided"}{session.track ? ` · ${session.track}` : ""}{session.room ? ` · ${session.room}` : ""}</p>
                      </li>)}
                    </ul>
                  )}
                </div>
                <div className="space-y-2 rounded-md border p-3">
                  <div className="flex items-start gap-2">
                    <Checkbox id="confirm-event-website-import" checked={confirmed} disabled={importEvent.isPending} onCheckedChange={(value) => setConfirmed(value === true)} />
                    <Label htmlFor="confirm-event-website-import" className="text-sm leading-relaxed">I have reviewed this preview. Import this event and {event.sessions.length} session{event.sessions.length !== 1 ? "s" : ""}, updating matching records.</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">The import re-fetches current details from the website. Re-importing the same source will not duplicate sessions. No posts are generated, scheduled, or sent.</p>
                </div>
              </div>
            )}
            {importEvent.isError && <p role="alert" className="text-sm text-destructive">Import failed: {importEvent.error.message}. Your preview is still available; retry when the website is ready.</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importEvent.isPending}>Cancel</Button>
              <Button disabled={!event || !confirmed || importEvent.isPending} onClick={() => { if (previewSource && confirmed && event) importEvent.mutate(previewSource); }}>
                {importEvent.isPending ? "Importing…" : "Confirm import"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
