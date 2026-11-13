import { useQuery } from "@tanstack/react-query";
import { CalendarClock, MapPin, RefreshCw, UserRound } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getTabMarketId, getTabTenantId } from "@/lib/tabContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CampaignMeeting, CampaignWorkspace } from "@shared/outreach-workspace";

const campaignWorkspaceKey = (campaignId: string, scope: string) =>
  ["campaign-next-steps", scope, campaignId, getTabTenantId(), getTabMarketId()] as const;

function meetingDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    label: date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "browser local timezone",
  };
}

function MeetingRow({ meeting, onOpenMeeting }: { meeting: CampaignMeeting; onOpenMeeting: (prospectId: string) => void }) {
  const date = meetingDate(meeting.meetingAt);
  return <li className="rounded-md border bg-background/60 p-3">
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={meeting.status === "booked" ? "secondary" : "outline"}>{meeting.status === "booked" ? "Booked" : date ? "Agreed" : "Agreed · scheduling needed"}</Badge>
      {date && <span className="text-xs text-muted-foreground"><CalendarClock className="mr-1 inline h-3.5 w-3.5" />{date.label} <span className="whitespace-nowrap">({date.timezone}, browser local time)</span></span>}
      {!date && meeting.status === "booked" && <span className="text-xs text-muted-foreground">Date and time not listed</span>}
    </div>
    <ul className="mt-2 space-y-1">
      {meeting.contacts.map(contact => <li key={contact.prospectId}>
        <Button variant="link" className="h-auto p-0 text-left text-sm font-medium" onClick={() => onOpenMeeting(contact.prospectId)}>
          {contact.name}{contact.companyName ? <span className="font-normal text-muted-foreground"> · {contact.companyName}</span> : null}
        </Button>
      </li>)}
    </ul>
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {meeting.owner && <span><UserRound className="mr-1 inline h-3.5 w-3.5" />{meeting.owner}</span>}
      {meeting.location && <span><MapPin className="mr-1 inline h-3.5 w-3.5" />{meeting.location}</span>}
    </div>
  </li>;
}

export default function CampaignOverview({ campaignId, scope, onOpenMeeting }: {
  campaignId: string;
  scope: string;
  onOpenMeeting: (prospectId: string) => void;
  onOpenHistory?: (prospectId: string) => void;
}) {
  const query = useQuery<CampaignWorkspace>({
    queryKey: campaignWorkspaceKey(campaignId, scope),
    queryFn: async () => (await apiRequest("GET", `/api/sales-outreach/campaigns/${campaignId}/next-steps`)).json(),
  });
  const counts = query.data?.counts;
  const meetings = query.data?.meetings ?? [];
  const metrics = counts ? [
    ["Active contacts", counts.contacts],
    ["Worked", counts.worked],
    ["Communicated contacts", counts.communicated],
    ["External contacts", counts.externallyContacted],
    ["External logged communications", counts.externalCommunications],
    ["Orbit messages", counts.sent],
    ["Replied contacts", counts.replied],
    ["Pending drafts", counts.pendingDrafts],
    ["Total meetings", counts.meetings],
    ["Booked", counts.bookedMeetings],
    ["Agreed · scheduling needed", counts.agreedMeetings],
  ] as const : [];

  return <section aria-label="Campaign overview" className="space-y-3 rounded-lg border bg-card p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h2 className="text-sm font-semibold">Campaign overview</h2><p className="mt-1 text-xs text-muted-foreground">Communicated contacts are distinct people with an actual sent or logged conversation. External activity is campaign-attributed, not a live mailbox scan.</p></div>
      <Button size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw className="mr-1 h-3 w-3" />Refresh</Button>
    </div>
    {query.isLoading ? <div className="grid animate-pulse grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" aria-label="Loading campaign overview">{Array.from({ length: 8 }, (_, index) => <div key={index} className="h-14 rounded-md bg-muted" />)}</div>
      : query.isError ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 p-3 text-sm"><p role="alert">Campaign activity could not be loaded.</p><Button variant="outline" size="sm" onClick={() => void query.refetch()}>Retry</Button></div>
      : counts && <><dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {metrics.map(([label, value]) => <div key={label} className="min-w-0 rounded-md border bg-muted/20 px-3 py-2">
          <dd className="text-lg font-semibold tabular-nums leading-tight">{value}</dd><dt className="mt-1 text-[11px] leading-snug text-muted-foreground">{label}</dt>
        </div>)}
      </dl>
      {meetings.length ? <div className="border-t pt-3">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><CalendarClock className="h-4 w-4 text-muted-foreground" />Meetings <span className="text-xs font-normal text-muted-foreground">{meetings.length} shared meeting{meetings.length === 1 ? "" : "s"}</span></h3>
        <ul className="space-y-2">{meetings.map(meeting => <MeetingRow key={meeting.id} meeting={meeting} onOpenMeeting={onOpenMeeting} />)}</ul>
      </div> : <div className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">No booked or agreed meetings are recorded for this campaign.</div>}
      <p className="text-[11px] text-muted-foreground">Distinct contacts are counted once. Shared meetings appear once, even when several contacts are attending.</p>
      </>}
  </section>;
}
