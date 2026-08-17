import { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getTabMarketId } from "@/lib/tabContext";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Ticket, Plus, ArrowRight, Archive, RotateCcw, CalendarRange, Megaphone, Filter } from "lucide-react";

// Event dates are floating wall-clock dates stored at UTC midnight. Render in
// UTC so they show exactly as entered, independent of the viewer's timezone.
function formatEventDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { timeZone: "UTC", dateStyle: "medium" });
}

interface Conference {
  id: string;
  name: string;
  description?: string | null;
  location?: string | null;
  website?: string | null;
  eventHashtag?: string | null;
  discountStatement?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  promoStartDate?: string | null;
  promoEndDate?: string | null;
  postsPerDay: number;
  status: string;
  archivedAt?: string | null;
  createdAt: string;
  campaignId?: string | null;
  campaignName?: string | null;
}

const EMPTY_FORM = {
  name: "",
  description: "",
  location: "",
  website: "",
  eventHashtag: "",
  discountStatement: "",
  startDate: "",
  endDate: "",
  promoStartDate: "",
  promoEndDate: "",
  postsPerDay: 2,
  includeSaturday: false,
  includeSunday: false,
  anchorPostCount: 2,
  variantsPerPost: 3,
  thematicBrief: "",
  alwaysHashtags: "",
};

export default function ConferencePromotionPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [filterCampaignLinked, setFilterCampaignLinked] = useState(false);

  const { data: conferences = [], isLoading } = useQuery<Conference[]>({
    queryKey: ["/api/conferences", getTabMarketId()],
    queryFn: async () => {
      const r = await fetch("/api/conferences", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const body = {
        ...form,
        alwaysHashtags: form.alwaysHashtags
          .split(/[,\s]+/)
          .map((t) => t.trim())
          .filter(Boolean),
        startDate: form.startDate ? new Date(form.startDate).toISOString() : undefined,
        endDate: form.endDate ? new Date(form.endDate).toISOString() : undefined,
        promoStartDate: form.promoStartDate ? new Date(form.promoStartDate).toISOString() : undefined,
        promoEndDate: form.promoEndDate ? new Date(form.promoEndDate).toISOString() : undefined,
      };
      const r = await fetch("/api/conferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to create event");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conferences"] });
      setOpen(false);
      setForm({ ...EMPTY_FORM });
      toast({ title: "Event created" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: async ({ id, archive }: { id: string; archive: boolean }) => {
      const r = await fetch(`/api/conferences/${id}/${archive ? "archive" : "unarchive"}`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Action failed");
      return r.json();
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conferences"] });
      toast({ title: vars.archive ? "Event archived" : "Event restored" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const allActive = conferences.filter((c) => c.status === "active");
  const active = filterCampaignLinked ? allActive.filter((c) => c.campaignId != null) : allActive;
  const allArchived = conferences.filter((c) => c.status === "archived");
  const archived = filterCampaignLinked ? allArchived.filter((c) => c.campaignId != null) : allArchived;

  return (
    <AppLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Ticket className="w-6 h-6" /> Event Promotion
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Set up anchor posts for your overall presence plus a matched post and graphic for every session you deliver.
              Generate 2-3 copy variations per post and schedule them across your promotion window.
            </p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-conference">
                <Plus className="w-4 h-4 mr-1" /> New Event
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>New Event</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid gap-2">
                  <Label>Event name *</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Microsoft Ignite 2026"
                    data-testid="input-conference-name"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Location</Label>
                    <Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="Chicago, IL" />
                  </div>
                  <div className="grid gap-2">
                    <Label>Event hashtag</Label>
                    <Input value={form.eventHashtag} onChange={(e) => setForm((f) => ({ ...f, eventHashtag: e.target.value }))} placeholder="#MSIgnite" />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Event website / registration link</Label>
                  <Input value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} placeholder="https://techcon365seattle.com" />
                  <p className="text-xs text-muted-foreground">The AI will use this URL as the call-to-action link in generated posts.</p>
                </div>
                <div className="grid gap-2">
                  <Label>Registration offer / discount code</Label>
                  <Input
                    value={form.discountStatement}
                    onChange={(e) => setForm((f) => ({ ...f, discountStatement: e.target.value }))}
                    placeholder="e.g. Save $200 with registration code SYNOZUR200"
                    data-testid="input-discount-statement"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Event start</Label>
                    <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Event end</Label>
                    <Input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
                  </div>
                </div>

                <div className="rounded-md border p-3 space-y-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <CalendarRange className="w-4 h-4" /> Promotion window & cadence
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label>Promotion start</Label>
                      <Input type="date" value={form.promoStartDate} onChange={(e) => setForm((f) => ({ ...f, promoStartDate: e.target.value }))} />
                    </div>
                    <div className="grid gap-2">
                      <Label>Promotion end</Label>
                      <Input type="date" value={form.promoEndDate} onChange={(e) => setForm((f) => ({ ...f, promoEndDate: e.target.value }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="grid gap-2">
                      <Label>Posts per day</Label>
                      <Input
                        type="number"
                        min={1}
                        max={12}
                        value={form.postsPerDay}
                        onChange={(e) => setForm((f) => ({ ...f, postsPerDay: Number(e.target.value) }))}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Anchor posts</Label>
                      <Input
                        type="number"
                        min={1}
                        max={2}
                        value={form.anchorPostCount}
                        onChange={(e) => setForm((f) => ({ ...f, anchorPostCount: Number(e.target.value) }))}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Copy variations</Label>
                      <Input
                        type="number"
                        min={2}
                        max={3}
                        value={form.variantsPerPost}
                        onChange={(e) => setForm((f) => ({ ...f, variantsPerPost: Number(e.target.value) }))}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <label className="flex items-center gap-2 text-sm">
                      <Switch checked={form.includeSaturday} onCheckedChange={(v) => setForm((f) => ({ ...f, includeSaturday: v }))} />
                      Post Saturdays
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Switch checked={form.includeSunday} onCheckedChange={(v) => setForm((f) => ({ ...f, includeSunday: v }))} />
                      Post Sundays
                    </label>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label>Always-on hashtags</Label>
                  <Input value={form.alwaysHashtags} onChange={(e) => setForm((f) => ({ ...f, alwaysHashtags: e.target.value }))} placeholder="comma or space separated" />
                </div>
                <div className="grid gap-2">
                  <Label>Theme / brief (guides AI copy & graphics)</Label>
                  <Textarea
                    rows={3}
                    value={form.thematicBrief}
                    onChange={(e) => setForm((f) => ({ ...f, thematicBrief: e.target.value }))}
                    placeholder="What's your story at this event? Key messages, products, booth, CTA…"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button
                    onClick={() => createMutation.mutate()}
                    disabled={!form.name.trim() || createMutation.isPending}
                    data-testid="button-create-conference"
                  >
                    {createMutation.isPending ? "Creating…" : "Create"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : conferences.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No events yet. Create one to start promoting your sessions.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <Button
                variant={filterCampaignLinked ? "default" : "outline"}
                size="sm"
                className="gap-1.5"
                onClick={() => setFilterCampaignLinked((v) => !v)}
                data-testid="filter-campaign-linked"
              >
                <Filter className="w-3.5 h-3.5" />
                <Megaphone className="w-3.5 h-3.5" />
                Campaign linked
              </Button>
              {filterCampaignLinked && (
                <span className="text-xs text-muted-foreground">
                  {active.length} of {allActive.length} event{allActive.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {active.length === 0 && filterCampaignLinked ? (
                <p className="text-sm text-muted-foreground col-span-2">No events with a linked campaign.</p>
              ) : null}
              {active.map((c) => (
                <ConferenceCard key={c.id} conf={c} onArchive={(id) => archiveMutation.mutate({ id, archive: true })} />
              ))}
            </div>

            {(allArchived.length > 0 && (!filterCampaignLinked || archived.length > 0)) && (
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground mb-2">Archived</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {archived.map((c) => (
                    <ConferenceCard
                      key={c.id}
                      conf={c}
                      archived
                      onUnarchive={(id) => archiveMutation.mutate({ id, archive: false })}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function ConferenceCard({
  conf,
  archived,
  onArchive,
  onUnarchive,
}: {
  conf: Conference;
  archived?: boolean;
  onArchive?: (id: string) => void;
  onUnarchive?: (id: string) => void;
}) {
  const dates =
    conf.startDate && conf.endDate
      ? `${formatEventDate(conf.startDate)} – ${formatEventDate(conf.endDate)}`
      : conf.startDate
      ? formatEventDate(conf.startDate)
      : "Dates TBD";
  return (
    <Card className={archived ? "opacity-70" : ""}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-lg">{conf.name}</CardTitle>
            <CardDescription>
              {conf.location ? `${conf.location} · ` : ""}
              {dates}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {conf.campaignId && (
              <Link href={`/app/marketing/campaigns/${conf.campaignId}`}>
                <Badge variant="outline" className="text-xs gap-1 cursor-pointer hover:bg-muted">
                  <Megaphone className="w-3 h-3" />
                  {conf.campaignName ?? "Campaign linked"}
                </Badge>
              </Link>
            )}
            {archived && <Badge variant="secondary">Archived</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{conf.postsPerDay} posts/day</span>
        <div className="flex items-center gap-2">
          {archived ? (
            <Button size="sm" variant="outline" onClick={() => onUnarchive?.(conf.id)}>
              <RotateCcw className="w-4 h-4 mr-1" /> Restore
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => onArchive?.(conf.id)} title="Archive after the event">
                <Archive className="w-4 h-4" />
              </Button>
              <Link href={`/app/marketing/conferences/${conf.id}`}>
                <Button size="sm">
                  Open <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
