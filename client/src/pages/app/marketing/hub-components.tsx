import { useState, useEffect, useMemo } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Plus, Link2, Unlink, Loader2, Share2, Mail, FileText,
  Calendar, Sparkles,
} from "lucide-react";

export type Scope = "campaign" | "theme";
export type ItemType = "social" | "email" | "content";
export type Stage = "draft" | "scheduled" | "approved" | "posted";

export interface HubItem {
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
  calendarId?: string | null;
  contentAssetId?: string | null;
  campaignId?: string | null;
  solutionAreaId?: string | null;
}

export interface HubResponse {
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

export const TYPE_META: Record<ItemType, { label: string; icon: typeof Share2 }> = {
  social: { label: "Social Posts", icon: Share2 },
  email: { label: "Emails", icon: Mail },
  content: { label: "Content", icon: FileText },
};

export const STAGE_META: Record<Stage, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  scheduled: { label: "Scheduled", className: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  approved: { label: "Approved", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  posted: { label: "Live", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
};

export const STAGE_ORDER: Stage[] = ["draft", "scheduled", "approved", "posted"];

export function RollupStat({ label, value, testId, highlight }: {
  label: string; value: number; testId: string; highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "bg-primary/5 border-primary/30" : "bg-card"}`} data-testid={testId}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

export function HubItemsList({
  hub,
  scope,
  id,
  onDetach,
  detachPending,
}: {
  hub: HubResponse;
  scope: Scope;
  id: string;
  onDetach: (item: { type: ItemType; id: string }) => void;
  detachPending: boolean;
}) {
  const itemsByType = useMemo(() => {
    const map: Record<ItemType, HubItem[]> = { social: [], email: [], content: [] };
    (hub.items ?? []).forEach((it) => map[it.type].push(it));
    return map;
  }, [hub]);

  if (hub.items.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center" data-testid="empty-no-items">
          <Sparkles className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium">Nothing planned yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Attach existing items or create a new proposed action to get started.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
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
                          ? (() => {
                              const p = new URLSearchParams();
                              if (item.calendarId) p.set("calendar", item.calendarId);
                              if (scope === "campaign" && id) p.set("campaignId", id);
                              else if (scope === "theme" && id) p.set("solutionAreaId", id);
                              p.set("brief", item.id);
                              return (
                                <Link href={`/app/marketing/editorial-calendar?${p.toString()}`} className="underline underline-offset-2 hover:text-foreground" data-testid={`link-open-item-${item.id}`}>Open in Content Briefs →</Link>
                              );
                            })()
                          : scope === "campaign"
                            ? <Link href={`/app/marketing/campaigns/${id}`} className="underline underline-offset-2 hover:text-foreground" data-testid={`link-open-item-${item.id}`}>Open in Campaign →</Link>
                            : <Link href="/app/marketing/calendar" className="underline underline-offset-2 hover:text-foreground" data-testid={`link-open-item-${item.id}`}>Open in Social Posts →</Link>
                        }
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => onDetach({ type: item.type, id: item.id })}
                      disabled={detachPending}
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
  );
}

export function AttachDialog({ open, onOpenChange, scope, id, onDone }: {
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

export function CreateActionDialog({ open, onOpenChange, scope, id, onDone }: {
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
              {type === "content" && "Creates a content placeholder linked to this plan. Open Content Briefs to write a brief and generate a draft."}
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
                  <SelectItem value="ebook">Ebook</SelectItem>
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
