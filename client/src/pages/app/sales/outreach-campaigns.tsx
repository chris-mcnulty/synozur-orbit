import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Send, Plus, ArrowRight, AlertTriangle, CheckCircle2 } from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface OutreachCampaign {
  id: string;
  name: string;
  goalType: string;
  salesGoal: string | null;
  status: string;
  channels: string[] | null;
  eventDate: string | null;
  updatedAt: string;
}

interface ReadinessItem {
  key: string;
  label: string;
  status: "ready" | "thin" | "missing";
  detail: string;
  fixHint: string;
  fixPath: string;
}
interface ReadinessReport {
  items: ReadinessItem[];
  score: number;
  overall: "ready" | "partial" | "incomplete";
}

const GOAL_LABELS: Record<string, string> = {
  meeting: "Meeting",
  event_invite: "Event invite",
  intro: "Intro",
  nurture: "Nurture",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  active: "default",
  draft: "secondary",
  paused: "outline",
  completed: "outline",
  archived: "outline",
};

/** Sales outreach campaign list + readiness banner + entry to the wizard. */
export default function OutreachCampaignsPage() {
  const { data: campaigns = [], isLoading } = useQuery<OutreachCampaign[]>({
    queryKey: ["/api/sales-outreach/campaigns"],
    queryFn: async () => {
      const r = await fetch("/api/sales-outreach/campaigns", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: readiness } = useQuery<ReadinessReport>({
    queryKey: ["/api/sales-outreach/readiness"],
    queryFn: async () => {
      const r = await fetch("/api/sales-outreach/readiness", { credentials: "include" });
      if (!r.ok) return null as any;
      return r.json();
    },
  });

  const blockers = readiness?.items.filter((i) => i.status === "missing") ?? [];

  return (
    <AppLayout>
      <div className="space-y-6" data-testid="page-outreach-campaigns">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2.5">
              <Send className="w-7 h-7 text-primary" /> Outreach Campaigns
            </h1>
            <p className="text-muted-foreground mt-1">
              Prospect, draft in your voice, and sequence follow-ups — you approve every send.
            </p>
          </div>
          <Button asChild data-testid="button-new-campaign">
            <Link href="/app/sales/outreach/new">
              <Plus className="w-4 h-4 mr-1.5" /> New campaign
            </Link>
          </Button>
        </div>

        {readiness && readiness.overall !== "ready" && (
          <Card className={blockers.length > 0 ? "border-amber-500/50" : ""}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                {blockers.length > 0 ? (
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                )}
                Outreach readiness — {readiness.score}%
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {blockers.length === 0 ? (
                <p className="text-sm text-muted-foreground">A few fields are thin but you're ready to start.</p>
              ) : (
                <ul className="space-y-1.5">
                  {blockers.map((b) => (
                    <li key={b.key} className="text-sm flex items-center justify-between gap-3">
                      <span><span className="font-medium">{b.label}:</span> <span className="text-muted-foreground">{b.fixHint}</span></span>
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={b.fixPath}>Fix <ArrowRight className="w-3.5 h-3.5 ml-1" /></Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading campaigns…</p>
        ) : campaigns.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center space-y-3">
              <Send className="w-10 h-10 text-muted-foreground/40 mx-auto" />
              <p className="text-muted-foreground">No outreach campaigns yet.</p>
              <Button asChild>
                <Link href="/app/sales/outreach/new"><Plus className="w-4 h-4 mr-1.5" /> Start your first campaign</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {campaigns.map((c) => (
              <Card key={c.id} className="flex flex-col" data-testid={`campaign-${c.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className="text-[11px]">{GOAL_LABELS[c.goalType] ?? c.goalType}</Badge>
                    <Badge variant={STATUS_VARIANT[c.status] ?? "secondary"} className="text-[11px] capitalize">{c.status}</Badge>
                  </div>
                  <CardTitle className="text-base mt-2">{c.name}</CardTitle>
                </CardHeader>
                <CardContent className="mt-auto space-y-3">
                  {c.salesGoal && <p className="text-sm text-muted-foreground line-clamp-2">{c.salesGoal}</p>}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {(c.channels ?? []).map((ch) => (
                      <Badge key={ch} variant="secondary" className="text-[10px] capitalize">{ch}</Badge>
                    ))}
                    {c.eventDate && (
                      <span className="text-[11px] text-muted-foreground">event {new Date(c.eventDate).toLocaleDateString()}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">
                      Updated {formatDistanceToNow(new Date(c.updatedAt), { addSuffix: true })}
                    </span>
                    <Button variant="ghost" size="sm" asChild data-testid={`open-campaign-${c.id}`}>
                      <Link href={`/app/sales/outreach/${c.id}`}>Open <ArrowRight className="w-3.5 h-3.5 ml-1" /></Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
