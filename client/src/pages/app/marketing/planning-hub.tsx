import { useState, useMemo, useEffect } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Target, Layers, Plus, Link2, Unlink, Loader2, Share2, Mail, FileText,
  Calendar, ExternalLink, Sparkles,
} from "lucide-react";

type Scope = "campaign" | "theme";
type ItemType = "social" | "email" | "content";
type Stage = "draft" | "scheduled" | "approved" | "posted";

interface HubItem {
  id: string;
  type: ItemType;
  title: string;
  preview: string;
  date: string | null;
  status: string;
  stage: Stage;
  platform?: string;
  format?: string;
  conferenceName?: string | null;
}
interface HubResponse {
  scope: Scope;
  id: string;
  name: string;
  description: string | null;
  items: HubItem[];
  rollup: {
    total: number;
    byStage: Record<Stage, number>;
    byType: Record<ItemType, number>;
  };
}
interface AvailableItem {
  id: string;
  type: ItemType;
  title: string;
  preview: string;
  status: string;
  format?: string;
  assignedCampaignId: string | null;
  assignedSolutionAreaId: string | null;
}
interface ScopesResponse {
  campaigns: { id: string; name: string; status: string }[];
  themes: { id: string; name: string; color: string | null }[];
}

const TYPE_META: Record<ItemType, { label: string; icon: typeof Share2 }> = {
  social: { label: "Social Posts", icon: Share2 },
  email: { label: "Emails", icon: Mail },
  content: { label: "Content", icon: FileText },
};

const STAGE_META: Record<Stage, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  scheduled: { label: "Scheduled", className: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  approved: { label: "Approved", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  posted: { label: "Live", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
};

const STAGE_ORDER: Stage[] = ["draft", "scheduled", "approved", "posted"];

export default function PlanningHubPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const params = new URLSearchParams(search);
  const scope = (params.get("scope") === "theme" ? "theme" : "campaign") as Scope;
  const id = params.get("id") || "";

  const setScopeParam = (s: Scope, newId: string) => {
    navigate(`/app/marketing/planning-hub?scope=${s}&id=${newId}`);
  };

  const { data: scopes, isLoading: scopesLoading } = useQuery<ScopesResponse>({
    queryKey: ["/api/planning-hub/scopes"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/planning-hub/scopes");
      return res.json();
    },
  });

  // Auto-select the first item of the active scope if none chosen.
  useEffect(() => {
    if (id || !scopes) return;
    const list = scope === "campaign" ? scopes.campaigns : scopes.themes;
    if (list.length > 0) setScopeParam(scope, list[0].id);
  }, [scopes, scope, id]);

  const { data: hub, isLoading: hubLoading } = useQuery<HubResponse>({
    queryKey: ["/api/planning-hub", scope, id],
    enabled: !!id,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/planning-hub?scope=${scope}&id=${id}`);
      return res.json();
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/planning-hub", scope, id] });
    queryClient.invalidateQueries({ queryKey: ["/api/planning-hub/available", scope, id] });
  };

  // ── Detach ──
  const detachMutation = useMutation({
    mutationFn: async (item: { type: ItemType; id: string }) => {
      const res = await apiRequest("POST", "/api/planning-hub/detach", { scope, id, items: [item] });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Removed", description: "Item detached from this plan." });
      refresh();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const scopeList = scope === "campaign" ? scopes?.campaigns ?? [] : scopes?.themes ?? [];
  const itemsByType = useMemo(() => {
    const map: Record<ItemType, HubItem[]> = { social: [], email: [], content: [] };
    (hub?.items ?? []).forEach((it) => map[it.type].push(it));
    return map;
  }, [hub]);

  const [attachOpen, setAttachOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [scopeCreateOpen, setScopeCreateOpen] = useState(false);

  return (
    <AppLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="page-header-gradient-bar rounded-lg p-6 bg-card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-planning-hub-title">
                <Target className="w-6 h-6" /> Planning Hub
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                One place to see and plan every piece of marketing for a campaign or theme.
              </p>
            </div>
          </div>

          {/* Scope picker */}
          <div className="flex flex-wrap items-center gap-3 mt-5">
            <Tabs value={scope} onValueChange={(v) => setScopeParam(v as Scope, "")}>
              <TabsList>
                <TabsTrigger value="campaign" className="gap-1.5" data-testid="tab-scope-campaign">
                  <Target className="w-3.5 h-3.5" /> Campaign
                </TabsTrigger>
                <TabsTrigger value="theme" className="gap-1.5" data-testid="tab-scope-theme">
                  <Layers className="w-3.5 h-3.5" /> Theme
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <Select value={id} onValueChange={(v) => setScopeParam(scope, v)}>
              <SelectTrigger className="w-72" data-testid="select-scope-target">
                <SelectValue placeholder={scopesLoading ? "Loading..." : `Select a ${scope}`} />
              </SelectTrigger>
              <SelectContent>
                {scopeList.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    No {scope === "campaign" ? "campaigns" : "themes"} yet
                  </div>
                ) : scopeList.map((s) => (
                  <SelectItem key={s.id} value={s.id} data-testid={`option-scope-${s.id}`}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setScopeCreateOpen(true)} data-testid="button-create-scope">
              <Plus className="w-3.5 h-3.5" /> New {scope === "campaign" ? "Campaign" : "Theme"}
            </Button>
          </div>
        </div>

        {!id ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground" data-testid="empty-no-scope">
              Select a {scope} above to start planning.
            </CardContent>
          </Card>
        ) : hubLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : hub ? (
          <>
            {/* Scope summary + rollup */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2" data-testid="text-scope-name">
                      {scope === "campaign" ? <Target className="w-5 h-5" /> : <Layers className="w-5 h-5" />}
                      {hub.name}
                    </CardTitle>
                    {hub.description && (
                      <CardDescription className="mt-1">{hub.description}</CardDescription>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {scope === "campaign" && (
                      <Button variant="outline" size="sm" asChild className="gap-1.5">
                        <Link href={`/app/marketing/campaigns/${id}`} data-testid="link-open-campaign">
                          <ExternalLink className="w-3.5 h-3.5" /> Open Campaign
                        </Link>
                      </Button>
                    )}
                    {scope === "theme" && (
                      <Button variant="outline" size="sm" asChild className="gap-1.5">
                        <Link href="/app/marketing/solution-areas" data-testid="link-open-themes">
                          <ExternalLink className="w-3.5 h-3.5" /> Manage Themes
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <RollupStat label="Total" value={hub.rollup.total} testId="rollup-total" highlight />
                  {STAGE_ORDER.map((st) => (
                    <RollupStat
                      key={st}
                      label={STAGE_META[st].label}
                      value={hub.rollup.byStage[st]}
                      testId={`rollup-stage-${st}`}
                    />
                  ))}
                  <RollupStat label="Types" value={Object.values(hub.rollup.byType).filter((n) => n > 0).length} testId="rollup-types" />
                </div>
              </CardContent>
            </Card>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <Button onClick={() => setAttachOpen(true)} variant="outline" className="gap-1.5" data-testid="button-attach-items">
                <Link2 className="w-4 h-4" /> Attach Existing
              </Button>
              <Button onClick={() => setCreateOpen(true)} className="gap-1.5" data-testid="button-create-action">
                <Plus className="w-4 h-4" /> New Action
              </Button>
            </div>

            {/* Items grouped by type */}
            {hub.items.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center" data-testid="empty-no-items">
                  <Sparkles className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm font-medium">Nothing planned yet</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Attach existing items or create a new proposed action to get started.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-5">
                {(Object.keys(TYPE_META) as ItemType[]).map((t) => {
                  const list = itemsByType[t];
                  if (list.length === 0) return null;
                  const Icon = TYPE_META[t].icon;
                  return (
                    <div key={t}>
                      <h3 className="text-sm font-semibold flex items-center gap-2 mb-2" data-testid={`heading-type-${t}`}>
                        <Icon className="w-4 h-4" /> {TYPE_META[t].label}
                        <Badge variant="secondary" className="text-[10px]">{list.length}</Badge>
                      </h3>
                      <div className="space-y-2">
                        {list.map((item) => (
                          <Card key={item.id} className="hover:border-primary/40 transition-colors" data-testid={`item-${item.id}`}>
                            <CardContent className="py-3 flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-sm truncate" data-testid={`text-item-title-${item.id}`}>
                                    {item.title}
                                  </span>
                                  <Badge className={`text-[10px] ${STAGE_META[item.stage].className}`} data-testid={`badge-stage-${item.id}`}>
                                    {STAGE_META[item.stage].label}
                                  </Badge>
                                  <Badge variant="outline" className="text-[10px]" data-testid={`badge-status-${item.id}`}>
                                    {item.status}
                                  </Badge>
                                  {item.format && <Badge variant="outline" className="text-[10px]">{item.format}</Badge>}
                                  {item.conferenceName && (
                                    <Badge variant="outline" className="text-[10px] gap-1">
                                      <Calendar className="w-2.5 h-2.5" />{item.conferenceName}
                                    </Badge>
                                  )}
                                </div>
                                {item.preview && (
                                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.preview}</p>
                                )}
                                {item.date && (
                                  <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                                    <Calendar className="w-3 h-3" />
                                    {new Date(item.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                                  </p>
                                )}
                                <p className="text-[11px] text-muted-foreground mt-1.5">
                                  {item.type === "content"
                                    ? <Link href="/app/marketing/editorial-calendar" className="underline underline-offset-2 hover:text-foreground" data-testid={`link-open-item-${item.id}`}>Open in Editorial Calendar →</Link>
                                    : scope === "campaign"
                                      ? <Link href={`/app/marketing/campaigns/${id}`} className="underline underline-offset-2 hover:text-foreground" data-testid={`link-open-item-${item.id}`}>Open in Campaign →</Link>
                                      : <Link href="/app/marketing/calendar" className="underline underline-offset-2 hover:text-foreground" data-testid={`link-open-item-${item.id}`}>Open in Calendar →</Link>
                                  }
                                </p>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground hover:text-destructive shrink-0"
                                onClick={() => detachMutation.mutate({ type: item.type, id: item.id })}
                                disabled={detachMutation.isPending}
                                data-testid={`button-detach-${item.id}`}
                              >
                                <Unlink className="w-3.5 h-3.5" />
                              </Button>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : null}
      </div>

      {id && (
        <>
          <AttachDialog open={attachOpen} onOpenChange={setAttachOpen} scope={scope} id={id} onDone={refresh} />
          <CreateActionDialog open={createOpen} onOpenChange={setCreateOpen} scope={scope} id={id} onDone={refresh} />
        </>
      )}
      <CreateScopeDialog
        open={scopeCreateOpen}
        onOpenChange={setScopeCreateOpen}
        scope={scope}
        onCreated={(newId) => {
          queryClient.invalidateQueries({ queryKey: ["/api/planning-hub/scopes"] });
          setScopeParam(scope, newId);
        }}
      />
    </AppLayout>
  );
}

function RollupStat({ label, value, testId, highlight }: { label: string; value: number; testId: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "bg-primary/5 border-primary/30" : "bg-card"}`} data-testid={testId}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function AttachDialog({ open, onOpenChange, scope, id, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; scope: Scope; id: string; onDone: () => void;
}) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Record<string, ItemType>>({});

  const { data: available = [], isLoading } = useQuery<AvailableItem[]>({
    queryKey: ["/api/planning-hub/available", scope, id],
    enabled: open && !!id,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/planning-hub/available?scope=${scope}&id=${id}`);
      return res.json();
    },
  });

  useEffect(() => { if (!open) setSelected({}); }, [open]);

  const attachMutation = useMutation({
    mutationFn: async () => {
      const items = Object.entries(selected).map(([itemId, type]) => ({ type, id: itemId }));
      const res = await apiRequest("POST", "/api/planning-hub/attach", { scope, id, items });
      return res.json();
    },
    onSuccess: (r: any) => {
      toast({ title: "Attached", description: `${r.affected} item(s) added to this plan.` });
      onOpenChange(false);
      onDone();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const selectedCount = Object.keys(selected).length;
  const toggle = (item: AvailableItem) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[item.id]) delete next[item.id];
      else next[item.id] = item.type;
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Attach existing items</DialogTitle>
          <DialogDescription>
            Pick marketing items to add to this {scope}. Items already attached elsewhere will be reassigned.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto space-y-2 pr-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : available.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8" data-testid="empty-no-available">
              No available items to attach.
            </p>
          ) : available.map((item) => {
            const Icon = TYPE_META[item.type].icon;
            const isAssignedElsewhere = scope === "campaign" ? !!item.assignedCampaignId : !!item.assignedSolutionAreaId;
            return (
              <label
                key={item.id}
                className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50"
                data-testid={`available-${item.id}`}
              >
                <Checkbox
                  checked={!!selected[item.id]}
                  onCheckedChange={() => toggle(item)}
                  data-testid={`checkbox-available-${item.id}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium truncate">{item.title}</span>
                    <Badge variant="outline" className="text-[10px]">{item.status}</Badge>
                    {isAssignedElsewhere && (
                      <Badge variant="secondary" className="text-[10px]">reassign</Badge>
                    )}
                  </div>
                  {item.preview && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{item.preview}</p>}
                </div>
              </label>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-attach">Cancel</Button>
          <Button
            onClick={() => attachMutation.mutate()}
            disabled={selectedCount === 0 || attachMutation.isPending}
            data-testid="button-confirm-attach"
          >
            {attachMutation.isPending ? "Attaching..." : `Attach ${selectedCount || ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateActionDialog({ open, onOpenChange, scope, id, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; scope: Scope; id: string; onDone: () => void;
}) {
  const { toast } = useToast();
  const [type, setType] = useState<ItemType>("social");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [platform, setPlatform] = useState("linkedin");
  const [format, setFormat] = useState("blog_post");

  useEffect(() => {
    if (!open) { setType("social"); setTitle(""); setDate(""); setPlatform("linkedin"); setFormat("blog_post"); }
  }, [open]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/planning-hub/items", {
        scope, id, type, title,
        date: date || undefined,
        platform: type === "social" ? platform : undefined,
        format: type === "content" ? format : undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Created", description: "New action added to this plan." });
      onOpenChange(false);
      onDone();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New proposed action</DialogTitle>
          <DialogDescription>Create a placeholder item under this {scope}. You can flesh it out later.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 block">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as ItemType)}>
              <SelectTrigger data-testid="select-action-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="social">Social Post</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="content">Content / Blog</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1.5">
              {type === "social" && "Creates a placeholder post. To generate AI-written social variants, open the campaign and click Generate Posts."}
              {type === "email" && "Creates an email placeholder. Write and send it from the campaign's email tools."}
              {type === "content" && "Creates a content placeholder linked to this plan. Open Editorial Calendar to write a brief and generate a draft."}
            </p>
          </div>
          <div>
            <Label className="mb-1.5 block">{type === "email" ? "Subject" : "Title / idea"}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What's this about?" data-testid="input-action-title" />
          </div>
          {type === "social" && (
            <div>
              <Label className="mb-1.5 block">Platform</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger data-testid="select-action-platform"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="linkedin">LinkedIn</SelectItem>
                  <SelectItem value="twitter">Twitter / X</SelectItem>
                  <SelectItem value="facebook">Facebook</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {type === "content" && (
            <div>
              <Label className="mb-1.5 block">Format</Label>
              <Select value={format} onValueChange={setFormat}>
                <SelectTrigger data-testid="select-action-format"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="blog_post">Blog Post</SelectItem>
                  <SelectItem value="whitepaper">Whitepaper</SelectItem>
                  <SelectItem value="case_study">Case Study</SelectItem>
                  <SelectItem value="landing_page">Landing Page</SelectItem>
                  <SelectItem value="video_script">Video Script</SelectItem>
                  <SelectItem value="podcast">Podcast</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="mb-1.5 block">Target date (optional)</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-action-date" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-action">Cancel</Button>
          <Button onClick={() => createMutation.mutate()} disabled={!title.trim() || createMutation.isPending} data-testid="button-confirm-action">
            {createMutation.isPending ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateScopeDialog({ open, onOpenChange, scope, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void; scope: Scope; onCreated: (id: string) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => { if (!open) { setName(""); setDescription(""); } }, [open]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const url = scope === "campaign" ? "/api/campaigns" : "/api/solution-areas";
      const res = await apiRequest("POST", url, { name, description: description || undefined });
      return res.json();
    },
    onSuccess: (row: any) => {
      toast({ title: "Created", description: `${scope === "campaign" ? "Campaign" : "Theme"} created.` });
      onOpenChange(false);
      if (row?.id) onCreated(row.id);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New {scope === "campaign" ? "Campaign" : "Theme"}</DialogTitle>
          <DialogDescription>
            Create a {scope === "campaign" ? "campaign" : "theme"} and start planning right away.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 block">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={scope === "campaign" ? "Q3 Launch" : "Cloud Security"} data-testid="input-scope-name" />
          </div>
          <div>
            <Label className="mb-1.5 block">Description (optional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} data-testid="input-scope-description" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-scope">Cancel</Button>
          <Button onClick={() => createMutation.mutate()} disabled={!name.trim() || createMutation.isPending} data-testid="button-confirm-scope">
            {createMutation.isPending ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
